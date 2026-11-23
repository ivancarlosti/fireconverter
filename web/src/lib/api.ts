// Typed client for the FireConverter API.
//
// Every request is same-origin, so no token is kept in JavaScript. Failures are
// normalised into `ApiError`, whose `code` is the machine readable value the
// server sends; the UI translates the code and shows the server message as a
// technical detail.
import type { FormatsResponse, Health, JobView } from '@/lib/types';

/** ApiError carries the status and the machine readable code of a failure. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** isAbortError reports a cancelled fetch or XHR. */
export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

interface ErrorBody {
  code?: string;
  error?: string;
}

function fallbackCode(status: number): string {
  if (status === 413) return 'too_large';
  if (status === 415) return 'unsupported';
  if (status === 429) return 'busy';
  if (status === 503) return 'ffmpeg_missing';
  if (status >= 500) return 'internal';
  return 'validation';
}

function parseError(status: number, body: string): ApiError {
  try {
    const parsed = JSON.parse(body) as ErrorBody;
    return new ApiError(status, parsed.code ?? fallbackCode(status), parsed.error ?? body);
  } catch {
    return new ApiError(status, fallbackCode(status), body || 'request failed');
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: { Accept: 'application/json', ...init?.headers },
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ApiError(0, 'network', error instanceof Error ? error.message : 'network error');
  }
  if (!response.ok) {
    throw parseError(response.status, await response.text());
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

/** getHealth reads the server capabilities and limits. */
export function getHealth(): Promise<Health> {
  return request<Health>('/api/health');
}

/** getFormats reads the server converter catalogue. */
export function getFormats(): Promise<FormatsResponse> {
  return request<FormatsResponse>('/api/formats');
}

/** uploadJob sends a multipart job with real upload progress. */
export function uploadJob(
  file: File,
  settings: Record<string, unknown>,
  onProgress: (percent: number) => void,
  signal: AbortSignal,
): Promise<JobView> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('file', file, file.name);
    form.append('settings', JSON.stringify(settings));

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/jobs');
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.responseType = 'text';

    const abort = () => xhr.abort();
    signal.addEventListener('abort', abort, { once: true });

    const cleanup = () => signal.removeEventListener('abort', abort);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress((event.loaded / event.total) * 100);
      }
    };
    xhr.onerror = () => {
      cleanup();
      reject(new ApiError(0, 'network', 'the upload failed'));
    };
    xhr.onabort = () => {
      cleanup();
      reject(new DOMException('aborted', 'AbortError'));
    };
    xhr.onload = () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as JobView);
        } catch {
          reject(new ApiError(xhr.status, 'internal', 'the server returned invalid JSON'));
        }
        return;
      }
      reject(parseError(xhr.status, xhr.responseText));
    };
    xhr.send(form);
  });
}

/** getJob polls one job. */
export function getJob(id: string): Promise<JobView> {
  return request<JobView>(`/api/jobs/${encodeURIComponent(id)}`);
}

/** confirmJob releases a target-size job after the review dialog. */
export function confirmJob(id: string): Promise<JobView> {
  return request<JobView>(`/api/jobs/${encodeURIComponent(id)}/confirm`, { method: 'POST' });
}

/** cancelJob stops a queued or running job. */
export function cancelJob(id: string): Promise<JobView> {
  return request<JobView>(`/api/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
}

/** deleteJob erases the job and its files. */
export function deleteJob(id: string): Promise<void> {
  return request<void>(`/api/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** downloadJob fetches a finished output and its file name. */
export async function downloadJob(url: string): Promise<{ blob: Blob; name: string }> {
  const response = await fetch(url, { headers: { Accept: '*/*' } });
  if (!response.ok) {
    throw parseError(response.status, await response.text());
  }
  const disposition = response.headers.get('Content-Disposition') ?? '';
  let name = 'converted';
  const utf8 = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  const plain = disposition.match(/filename="?([^";]+)"?/i);
  if (utf8?.[1]) {
    name = decodeURIComponent(utf8[1]);
  } else if (plain?.[1]) {
    name = plain[1];
  }
  return { blob: await response.blob(), name };
}
