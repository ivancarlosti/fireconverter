package jobs

import (
	"context"
	"errors"
	"os"
	"time"

	"github.com/ivancarlosti/fireconverter/internal/convert"
)

// Start launches the workers and the TTL sweeper.
func (m *Manager) Start(parent context.Context) {
	if m.ctx != nil {
		return
	}
	m.ctx, m.cancel = context.WithCancel(parent)
	for i := 0; i < m.cfg.MaxConcurrentJobs; i++ {
		m.wg.Add(1)
		go m.worker()
	}
	m.wg.Add(1)
	go m.cleaner()
}

// Stop cancels running encodes and waits for the workers.
func (m *Manager) Stop() {
	if m.cancel != nil {
		m.cancel()
	}
	m.wg.Wait()
	m.ctx = nil
}

func (m *Manager) worker() {
	defer m.wg.Done()
	for {
		select {
		case <-m.ctx.Done():
			return
		case job := <-m.queue:
			m.run(job)
		}
	}
}

// run executes one job. The input is erased after the encode; the output stays
// until the TTL sweep or an explicit delete.
func (m *Manager) run(job *Job) {
	if !job.begin(m.ctx) {
		return
	}
	defer func() {
		if job.cancel != nil {
			job.cancel()
		}
		_ = os.Remove(job.inputPath)
	}()

	request := convert.Request{
		InputPath:  job.inputPath,
		OutputPath: job.outputPath,
		Kind:       job.Kind,
		Output:     job.Output,
		Probe:      job.Probe,
		Plan:       job.Plan,
		CRF:        job.RequestedCRF,
		AudioKbps:  job.RequestedKbps,
		Scale:      job.Scale,
		FPS:        job.FPS,
		OnProgress: job.setProgress,
	}
	result, err := convert.Run(job.ctx, m.ffmpegPath, request)
	if err != nil {
		if job.isCanceled() || errors.Is(err, context.Canceled) {
			job.markCanceled()
		} else {
			job.fail(errorCode(err), errorMessage(err))
		}
		_ = os.Remove(job.outputPath)
		return
	}
	job.finish(result.OutputSize, result.Retried, result.Warnings)
}

// Confirm releases a target-size job after the review dialog.
func (m *Manager) Confirm(id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	job, ok := m.jobs[id]
	if !ok {
		return ErrNotFound
	}
	job.mu.Lock()
	if job.Status != StatusAwaiting {
		job.mu.Unlock()
		return ErrInvalidState
	}
	job.Status = StatusQueued
	job.Stage = "queued"
	job.UpdatedAt = time.Now().UTC()
	job.mu.Unlock()

	if err := m.enqueueLocked(job); err != nil {
		job.mu.Lock()
		job.Status = StatusAwaiting
		job.Stage = "awaiting_confirmation"
		job.mu.Unlock()
		return err
	}
	return nil
}

// Cancel stops a waiting or running job.
func (m *Manager) Cancel(id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	job, ok := m.jobs[id]
	if !ok {
		return false
	}
	job.mu.Lock()
	defer job.mu.Unlock()
	switch job.Status {
	case StatusAwaiting, StatusQueued, StatusRunning:
		job.Status = StatusCanceled
		job.Stage = "canceled"
		job.FinishedAt = time.Now().UTC()
		job.UpdatedAt = job.FinishedAt
		if job.cancel != nil {
			job.cancel()
		}
		return true
	default:
		return false
	}
}

// Delete removes a job from the map and erases its directory shortly after the
// worker has had time to stop.
func (m *Manager) Delete(id string) bool {
	m.mu.Lock()
	job, ok := m.jobs[id]
	if !ok {
		m.mu.Unlock()
		return false
	}
	delete(m.jobs, id)
	m.mu.Unlock()

	job.mu.Lock()
	if job.cancel != nil {
		job.cancel()
	}
	if job.Status != StatusDone {
		job.Status = StatusCanceled
	}
	dir := job.dir
	job.mu.Unlock()

	go func() {
		time.Sleep(5 * time.Second)
		_ = os.RemoveAll(dir)
	}()
	return true
}
