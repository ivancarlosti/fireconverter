/** MediaKind is the three converter categories. */
export type MediaKind = 'image' | 'audio' | 'video';

/** Engine names where a conversion can run. */
export type Engine = 'local' | 'server';

/** FileStatus is the lifecycle of one file card. */
export type FileStatus =
  | 'ready'
  | 'uploading'
  | 'awaiting'
  | 'queued'
  | 'converting'
  | 'done'
  | 'error'
  | 'canceled';

/** Fit is how the image resize box is applied. */
export type Fit = 'contain' | 'cover' | 'stretch';

/** QualityPreset is the video CRF preset. */
export type QualityPreset = 'high' | 'balanced' | 'small';

/** FileSettings is what the user can change per file. */
export interface FileSettings {
  format: string;
  mode: 'quality' | 'target';
  /** quality is 1..100 for images. */
  quality: number;
  targetMB: number;
  width: string;
  height: string;
  fit: Fit;
  noUpscale: boolean;
  background: string;
  audioKbps: number;
  videoPreset: QualityPreset;
  scale: string;
  fps: string;
  engine: Engine;
}

/** MediaProbe is the metadata shown on a card and used by the planner. */
export interface MediaProbe {
  duration: number;
  width?: number;
  height?: number;
  hasAudio: boolean;
}

/** Plan mirrors the Go target-size calculation. */
export interface Plan {
  target_bytes: number;
  target_mb: number;
  duration_seconds: number;
  video_bitrate_kbps?: number;
  audio_bitrate_kbps?: number;
  passes: number;
  estimated_bytes: number;
  min_target_bytes?: number;
  width?: number;
  height?: number;
  fps?: number;
  scale?: string;
  warnings?: string[];
}

/** Result is a finished local or server conversion. */
export interface Result {
  name: string;
  size: number;
  engine: Engine;
  /** url is the local blob URL (revoked when the card is removed). */
  url?: string;
  /** downloadUrl is the server endpoint, fetched on demand. */
  downloadUrl?: string;
  width?: number;
  height?: number;
  duration?: number;
}

/** FileItem is one card of the queue. */
export interface FileItem {
  id: string;
  file: File;
  kind: MediaKind;
  name: string;
  size: number;
  status: FileStatus;
  /** progress is 0..100. */
  progress: number;
  /** stage is a translation key suffix under `status`. */
  stage: string;
  errorCode?: string;
  errorMessage?: string;
  warnings: string[];
  settings: FileSettings;
  probe?: MediaProbe;
  plan?: Plan;
  result?: Result;
  previewUrl?: string;
  jobId?: string;
}

/** JobView is the server job JSON. */
export interface JobView {
  id: string;
  status: 'awaiting_confirmation' | 'queued' | 'running' | 'done' | 'failed' | 'canceled';
  stage: string;
  progress: number;
  file_name: string;
  kind: MediaKind;
  output: string;
  output_name: string;
  input_size: number;
  output_size: number;
  plan?: Plan;
  probe?: {
    duration_seconds: number;
    width?: number;
    height?: number;
    fps?: number;
    has_audio: boolean;
  };
  error_code?: string;
  error_message?: string;
  warnings?: string[];
  created_at: string;
  updated_at: string;
  finished_at?: string;
  download_url?: string;
}

/** Health is GET /api/health. */
export interface Health {
  status: string;
  version: {
    name: string;
    version: string;
    commit: string;
    go_version: string;
    build_date?: string;
  };
  server_conversion: boolean;
  ffmpeg_version?: string;
  max_upload_bytes: number;
  max_duration_seconds: number;
  target_size_max_bytes: number;
  job_ttl_seconds: number;
  max_concurrent_jobs: number;
  max_jobs_per_ip: number;
  uptime_seconds: number;
  locales: string[];
  themes: string[];
}

/** FormatOption is one entry of an output picker. */
export interface FormatOption {
  value: string;
  label: string;
}

/** ServerFormat is GET /api/formats outputs. */
export interface ServerFormat {
  ext: string;
  kind: MediaKind;
  mime: string;
  label: string;
  target_size: boolean;
}

/** FormatsResponse is GET /api/formats. */
export interface FormatsResponse {
  outputs: ServerFormat[];
  input_extensions: string[];
  server_conversion: boolean;
  limits: {
    max_upload_bytes: number;
    max_duration_seconds: number;
    target_size_max_bytes: number;
    max_concurrent_jobs: number;
    max_jobs_per_ip: number;
    job_ttl_seconds: number;
  };
}
