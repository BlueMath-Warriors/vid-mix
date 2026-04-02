/**
 * Video Lab Editor - State Management
 * Central state, constants, and presets
 */

// Timeline zoom: pixels per second on the ruler/tracks
const TIMELINE_ZOOM_MIN = 1;
const TIMELINE_ZOOM_MAX = 48;
const DEFAULT_TIMELINE_ZOOM = 24;

// ============================================
// State Management
// ============================================
const VideoEditorState = {
  assets: [],
  timeline: [],
  // Two separate audio tracks
  detachedAudioTimeline: [], // Audio detached from video clips
  customAudioTimeline: [], // User-uploaded custom audio
  selectedSegment: null,
  selectedAudioSegment: null, // Track selected audio segment
  currentAsset: null,
  currentPreviewSegment: null, // Track which segment is shown in preview for crop
  isPlaying: false,
  isMuted: false,
  isDetachedAudioMuted: false, // Mute detached audio track
  isCustomAudioMuted: false, // Mute custom audio track
  zoomLevel: DEFAULT_TIMELINE_ZOOM,
  ffmpegLoaded: false,
  ffmpegLoading: false, // Track if FFmpeg is currently being pre-loaded
  ffmpeg: null,
  timelinePlaybackMode: false,
  currentTimelineIndex: 0,
  currentAudioIndex: 0, // Track current audio segment during playback
  textFrameStartTime: 0,
  imageFrameStartTime: 0,
  splitToolActive: false,
  currentTime: 0,
  totalDuration: 0,
  audioDuration: 0, // Duration of audio track (max of both audio tracks)
  playbackSpeed: 1,
  // Audio elements for playback
  audioElements: new Map(), // Map of audio segment id -> HTMLAudioElement
  // Project canvas settings
  projectResolution: {
    preset: '1080p',
    width: 1920,
    height: 1080
  },
  // Export settings
  exportResolution: {
    preset: 'project', // Use project resolution by default
    width: 1920,
    height: 1080
  },
  exportQuality: 'draft', // Export quality preset: draft, standard, high, production
  // Export tracking
  exportStartTime: 0,
  prefetchedAssets: new Map(), // Pre-fetched asset data for faster export
  // Crop/Transform modal state
  cropSegmentId: null,
  cropAspectRatio: 'free',
  cropBox: { x: 0, y: 0, width: 100, height: 100 },
  cropVideoWidth: 0,
  cropVideoHeight: 0,
  // Clip transform being edited
  editingTransform: {
    x: 0,
    y: 0,
    scale: 100,
    cropX: 0,
    cropY: 0,
    cropWidth: 0,
    cropHeight: 0
  },
  // Filter state
  activeFilterPreset: 'none',
  filters: {
    brightness: 100,
    contrast: 100,
    saturation: 100,
    hue: 0,
    blur: 0,
    vignette: 0
  }
};

// ============================================
// Resolution Presets
// ============================================
const resolutionPresets = {
  // Landscape resolutions
  '1080p': { width: 1920, height: 1080, label: '1080p Full HD', category: 'landscape' },
  '720p': { width: 1280, height: 720, label: '720p HD', category: 'landscape' },
  '480p': { width: 854, height: 480, label: '480p SD', category: 'landscape' },
  '360p': { width: 640, height: 360, label: '360p', category: 'landscape' },
  // Portrait/Vertical resolutions (mobile, TikTok, Reels)
  '1080p-portrait': { width: 1080, height: 1920, label: '1080p Portrait', category: 'portrait' },
  '720p-portrait': { width: 720, height: 1280, label: '720p Portrait', category: 'portrait' },
  // Square resolutions (Instagram)
  '1080-square': { width: 1080, height: 1080, label: '1080×1080 Square', category: 'square' },
  '720-square': { width: 720, height: 720, label: '720×720 Square', category: 'square' },
  // Special formats
  'ultrawide': { width: 2560, height: 1080, label: '21:9 Ultrawide', category: 'special' },
  'instagram-portrait': { width: 1080, height: 1350, label: '1080×1350 Instagram', category: 'special' }
};

// Export resolution presets for the export modal
const exportResolutionPresets = [
  { id: '1080p', width: 1920, height: 1080, label: '1080p Full HD', desc: '1920 × 1080' },
  { id: '720p', width: 1280, height: 720, label: '720p HD', desc: '1280 × 720' },
  { id: '480p', width: 854, height: 480, label: '480p SD', desc: '854 × 480' },
  { id: '360p', width: 640, height: 360, label: '360p', desc: '640 × 360' },
  { id: '1080p-portrait', width: 1080, height: 1920, label: '1080p Portrait', desc: '1080 × 1920' },
  { id: '720p-portrait', width: 720, height: 1280, label: '720p Portrait', desc: '720 × 1280' },
  { id: '1080-square', width: 1080, height: 1080, label: '1080p Square', desc: '1080 × 1080' },
  { id: 'project', width: 0, height: 0, label: 'Match Project', desc: 'Use project resolution' }
];

// ============================================
// Filter Presets
// ============================================
const filterPresets = {
  none: { brightness: 100, contrast: 100, saturation: 100, hue: 0, blur: 0, vignette: 0 },
  grayscale: { brightness: 100, contrast: 100, saturation: 0, hue: 0, blur: 0, vignette: 0 },
  sepia: { brightness: 100, contrast: 100, saturation: 50, hue: 30, blur: 0, vignette: 20 },
  vintage: { brightness: 90, contrast: 90, saturation: 80, hue: 15, blur: 0, vignette: 40 },
  warm: { brightness: 105, contrast: 100, saturation: 140, hue: 350, blur: 0, vignette: 0 },
  cool: { brightness: 105, contrast: 100, saturation: 90, hue: 200, blur: 0, vignette: 0 },
  dramatic: { brightness: 90, contrast: 130, saturation: 120, hue: 0, blur: 0, vignette: 50 },
  fade: { brightness: 115, contrast: 85, saturation: 80, hue: 0, blur: 0, vignette: 0 }
};

// ============================================
// Export Quality Presets
// ============================================
const exportQualityPresets = {
  draft: {
    id: 'draft',
    preset: 'fast',
    crf: 28,
    audioBitrate: '128k',
    fps: 24,
    twoPass: false,
    parallelSegments: 6,
    label: 'Draft (Fastest)',
    description: 'Quick preview, lower quality',
    icon: 'fa-bolt'
  },
  standard: {
    id: 'standard',
    preset: 'medium',
    crf: 23,
    audioBitrate: '192k',
    fps: 24,
    twoPass: false,
    parallelSegments: 4,
    label: 'Standard',
    description: 'Balanced speed and quality',
    icon: 'fa-balance-scale'
  },
  // high: {
  //   id: 'high',
  //   preset: 'medium',
  //   crf: 20,
  //   audioBitrate: '192k',
  //   fps: 30,
  //   twoPass: false,
  //   parallelSegments: 2,
  //   label: 'High Quality',
  //   description: 'Better quality, slower export',
  //   icon: 'fa-star'
  // },
  // production: {
  //   id: 'production',
  //   preset: 'slow',
  //   crf: 18,
  //   audioBitrate: '256k',
  //   fps: 30,
  //   twoPass: true,
  //   parallelSegments: 2,
  //   label: 'Production',
  //   description: 'Best quality, slowest export',
  //   icon: 'fa-gem'
  // }
};

// ============================================
// Timeline Constants
// ============================================
const clipColors = [
  'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
  'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)',
  'linear-gradient(135deg, #ec4899 0%, #be185d 100%)',
  'linear-gradient(135deg, #10b981 0%, #047857 100%)',
  'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
  'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)',
];

// Audio track colors (green-teal palette)
const audioColors = [
  'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
  'linear-gradient(135deg, #14b8a6 0%, #0d9488 100%)',
  'linear-gradient(135deg, #06b6d4 0%, #0891b2 100%)',
  'linear-gradient(135deg, #10b981 0%, #059669 100%)',
  'linear-gradient(135deg, #34d399 0%, #10b981 100%)',
  'linear-gradient(135deg, #2dd4bf 0%, #14b8a6 100%)',
];

// Minimum segment width in pixels (for very short clips)
const MIN_SEGMENT_WIDTH = 40;
const SMALL_CLIP_THRESHOLD = 80;

// ============================================
// Video Element Pool - Faster Seeking
// ============================================
const videoPool = {
  pool: new Map(), // assetId -> { video: HTMLVideoElement, lastUsed: timestamp }
  maxSize: 5, // Maximum number of cached video elements
  
  /**
   * Get or create a video element for an asset
   * @param {Object} asset - The asset object
   * @returns {HTMLVideoElement}
   */
  get(asset) {
    if (!asset || !asset.id) return null;
    
    if (this.pool.has(asset.id)) {
      const entry = this.pool.get(asset.id);
      entry.lastUsed = Date.now();
      return entry.video;
    }
    
    // Create new video element
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true; // Muted to allow autoplay
    video.playsInline = true;
    
    // Only set crossOrigin for truly external URLs (different domain)
    // Same-origin URLs don't need it and it can break video loading
    const isExternalUrl = asset.objectUrl?.startsWith('http') && !asset.objectUrl?.includes(window.location.host);
    if (isExternalUrl) {
      video.crossOrigin = 'anonymous';
    }
    
    video.src = asset.objectUrl;
    
    // Evict oldest if at capacity
    if (this.pool.size >= this.maxSize) {
      this._evictOldest();
    }
    
    this.pool.set(asset.id, {
      video,
      lastUsed: Date.now()
    });
    
    return video;
  },
  
  /**
   * Remove an asset's video from the pool
   * @param {string} assetId
   */
  remove(assetId) {
    if (this.pool.has(assetId)) {
      const entry = this.pool.get(assetId);
      entry.video.src = '';
      entry.video.load();
      this.pool.delete(assetId);
    }
  },
  
  /**
   * Evict the least recently used video element
   */
  _evictOldest() {
    let oldestId = null;
    let oldestTime = Infinity;
    
    for (const [id, entry] of this.pool) {
      if (entry.lastUsed < oldestTime) {
        oldestTime = entry.lastUsed;
        oldestId = id;
      }
    }
    
    if (oldestId) {
      this.remove(oldestId);
    }
  },
  
  /**
   * Clear all cached video elements
   */
  clear() {
    for (const [id] of this.pool) {
      this.remove(id);
    }
  },
  
  /**
   * Pre-warm the pool with timeline assets
   */
  preWarm(assets, timeline) {
    // Pre-load videos for assets that are on the timeline
    const timelineAssetIds = new Set(timeline.map(s => s.assetId).filter(Boolean));
    assets
      .filter(a => a.type === 'video' && timelineAssetIds.has(a.id))
      .slice(0, this.maxSize)
      .forEach(asset => this.get(asset));
  }
};

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.VideoEditor = window.VideoEditor || {};
  window.VideoEditor.state = VideoEditorState;
  window.VideoEditor.resolutionPresets = resolutionPresets;
  window.VideoEditor.exportResolutionPresets = exportResolutionPresets;
  window.VideoEditor.filterPresets = filterPresets;
  window.VideoEditor.exportQualityPresets = exportQualityPresets;
  window.VideoEditor.clipColors = clipColors;
  window.VideoEditor.audioColors = audioColors;
  window.VideoEditor.MIN_SEGMENT_WIDTH = MIN_SEGMENT_WIDTH;
  window.VideoEditor.SMALL_CLIP_THRESHOLD = SMALL_CLIP_THRESHOLD;
  window.VideoEditor.videoPool = videoPool;
  window.VideoEditor.TIMELINE_ZOOM_MIN = TIMELINE_ZOOM_MIN;
  window.VideoEditor.TIMELINE_ZOOM_MAX = TIMELINE_ZOOM_MAX;
  window.VideoEditor.DEFAULT_TIMELINE_ZOOM = DEFAULT_TIMELINE_ZOOM;
}

