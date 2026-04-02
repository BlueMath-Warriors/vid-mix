/**
 * Video Lab Editor - Export Module
 * FFmpeg export, MediaRecorder fallback, progress tracking
 */

(function() {
  'use strict';
  
  const VE = window.VideoEditor = window.VideoEditor || {};

  // ============================================
  // Export Progress State
  // ============================================
  let exportProgressState = {
    currentSegment: 0,
    totalSegments: 1,
    phase: 'idle', // 'idle', 'loading', 'prefetch', 'segments', 'concat', 'finalize'
    lastProgressValue: 0,
    animationFrame: null,
    isExporting: false
  };

  // ============================================
  // Logging Helper
  // ============================================
  function logExport(level, message, meta) {
    const prefix = '[VideoExport]';
    const payload = meta !== undefined ? meta : '';
    switch (level) {
      case 'warn':
        console.warn(prefix, message, payload);
        break;
      case 'error':
        console.error(prefix, message, payload);
        break;
      case 'info':
      default:
        console.log(prefix, message, payload);
    }
  }

  // ============================================
  // Export Modal Functions
  // ============================================
  VE.openExportModal = function() {
    if (VE.state.timeline.length === 0) {
      logExport('warn', 'Attempted to open export modal with empty timeline');
      VE.showToast('warning', 'Nothing to Export', 'Add clips to the timeline first');
      return;
    }
    
    // Initialize export resolution to project resolution
    VE.state.exportResolution = {
      preset: 'project',
      width: VE.state.projectResolution.width,
      height: VE.state.projectResolution.height
    };
    
    // Update resolution selector if exists
    if (VE.elements.exportResolution) {
      VE.elements.exportResolution.value = 'project';
    }
    
    // Update resolution info display
    if (VE.elements.exportResolutionInfo) {
      VE.elements.exportResolutionInfo.textContent = `Resolution: ${VE.state.projectResolution.width} × ${VE.state.projectResolution.height} (Project)`;
    }
    
    // Generate quality preset UI
    renderQualityPresets();
    
    // Reset progress state
    exportProgressState.lastProgressValue = 0;
    exportProgressState.isExporting = false;
    exportProgressState.phase = 'idle';
    setProgressBar(0);
    resetPhaseIndicators();
    VE.elements.progressText.textContent = 'Ready to export';
    VE.elements.startExportBtn.disabled = false;

    logExport('info', 'Export modal opened', {
      projectResolution: { ...VE.state.projectResolution },
      exportResolution: { ...VE.state.exportResolution },
      timelineLength: VE.state.timeline.length
    });

    VE.elements.exportModal.classList.add('show');
  };

  function renderQualityPresets() {
    // Find the quality options container in the HTML
    const qualitySection = VE.elements.exportModal?.querySelector('.export-quality-section');
    if (!qualitySection) return;
    
    // Update active state based on current quality setting
    const qualityOptions = qualitySection.querySelectorAll('.export-quality-option');
    qualityOptions.forEach(option => {
      const quality = option.dataset.quality;
      if (quality === VE.state.exportQuality) {
        option.classList.add('active');
      } else {
        option.classList.remove('active');
      }
    });
    
    // Update settings info text
    const settingsInfo = qualitySection.querySelector('#export-settings-text');
    if (settingsInfo) {
      settingsInfo.textContent = getQualityInfoText(VE.state.exportQuality);
    }
    
    // Add event listeners to quality options
    qualityOptions.forEach(option => {
      // Remove existing listeners by cloning
      const newOption = option.cloneNode(true);
      option.parentNode.replaceChild(newOption, option);
      
      newOption.addEventListener('click', () => {
        // Update state
        VE.state.exportQuality = newOption.dataset.quality;
        
        // Update active state
        qualitySection.querySelectorAll('.export-quality-option').forEach(opt => {
          opt.classList.remove('active');
        });
        newOption.classList.add('active');
        
        // Update info text
        const settingsText = qualitySection.querySelector('#export-settings-text');
        if (settingsText) {
          settingsText.textContent = getQualityInfoText(VE.state.exportQuality);
        }
      });
    });
  }

  function getQualityInfoText(qualityId) {
    const preset = VE.exportQualityPresets[qualityId];
    if (!preset) return '';
    
    const details = [];
    details.push(`Encoder: x264 ${preset.preset}`);
    details.push(`Quality: CRF ${preset.crf}`);
    details.push(`Audio: ${preset.audioBitrate}`);
    if (preset.twoPass) details.push('2-pass encoding');
    
    return details.join(' • ');
  }

  VE.closeExportModal = function() {
    VE.elements.exportModal.classList.remove('show');
  };

  VE.startExport = async function() {
    // Set export start time at the very beginning
    VE.state.exportStartTime = Date.now();
    
    logExport('info', 'Export requested by user', {
      totalTimelineSegments: VE.state.timeline.length,
      totalDetachedAudioSegments: VE.state.detachedAudioTimeline?.length || 0,
      totalCustomAudioSegments: VE.state.customAudioTimeline?.length || 0,
      exportFormat: VE.elements.exportFormat?.value,
      exportQuality: VE.state.exportQuality,
      projectResolution: { ...VE.state.projectResolution },
      exportResolution: { ...VE.state.exportResolution }
    });

    
    const loaded = await VE.loadFFmpeg();
    if (!loaded) {
      logExport('warn', 'FFmpeg WASM not available, falling back to MediaRecorder');
      exportWithMediaRecorder();
      return;
    }

    logExport('info', 'FFmpeg WASM available, starting FFmpeg export');
    exportWithFFmpeg();
  };

  // Smooth progress animation helper - ensures progress never goes backwards
  function animateProgressTo(targetProgress, duration = 500) {
    // Never go backwards
    if (targetProgress <= exportProgressState.lastProgressValue) {
      return;
    }
    
    const startProgress = exportProgressState.lastProgressValue;
    const startTime = performance.now();
    
    if (exportProgressState.animationFrame) {
      cancelAnimationFrame(exportProgressState.animationFrame);
    }
    
    function animate() {
      if (!exportProgressState.isExporting) return;
      
      const elapsed = performance.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      const currentProgress = startProgress + (targetProgress - startProgress) * eased;
      
      setProgressBar(currentProgress);
      exportProgressState.lastProgressValue = currentProgress;
      
      if (progress < 1) {
        exportProgressState.animationFrame = requestAnimationFrame(animate);
      }
    }
    
    animate();
  }
  
  // Direct progress bar update (no animation)
  function setProgressBar(percent) {
    const clampedPercent = Math.min(100, Math.max(0, percent));
    VE.elements.progressFill.style.width = `${clampedPercent}%`;
  }
  
  // Format elapsed time nicely (e.g., "2m 34s" or "45s")
  function formatElapsedTime(seconds) {
    if (seconds < 60) {
      return `${seconds}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (minutes < 60) {
      return secs > 0 ? `${minutes}m ${secs}s` : `${minutes}m`;
    }
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (mins > 0) {
      return `${hours}h ${mins}m`;
    }
    return `${hours}h`;
  }
  
  // Get current elapsed time since export started
  function getElapsedTime() {
    if (!VE.state.exportStartTime || VE.state.exportStartTime === 0) {
      return null;
    }
    const elapsedSeconds = Math.floor((Date.now() - VE.state.exportStartTime) / 1000);
    return formatElapsedTime(elapsedSeconds);
  }
  
  // Safe progress update - never goes backwards
  function safeUpdateProgress(percent, text) {
    if (percent > exportProgressState.lastProgressValue) {
      exportProgressState.lastProgressValue = percent;
      setProgressBar(percent);
    }
    if (text) {
      // Append elapsed time if export is in progress
      const elapsedTime = getElapsedTime();
      if (elapsedTime && exportProgressState.isExporting) {
        VE.elements.progressText.textContent = `${text} (${elapsedTime})`;
      } else {
        VE.elements.progressText.textContent = text;
      }
    }
  }
  
  // Phase indicator constants - maps phase to order
  const PHASE_ORDER = ['loading', 'prefetch', 'segments', 'concat', 'finalize'];
  
  // Update the visual phase indicators
  function updatePhaseIndicator(currentPhase) {
    const phasesContainer = document.getElementById('export-phases');
    if (!phasesContainer) return;
    
    const phases = phasesContainer.querySelectorAll('.export-phase');
    const connectors = phasesContainer.querySelectorAll('.phase-connector');
    const currentIndex = PHASE_ORDER.indexOf(currentPhase);
    
    phases.forEach((phaseEl, index) => {
      const phaseName = phaseEl.dataset.phase;
      const phaseIndex = PHASE_ORDER.indexOf(phaseName);
      
      // Remove all state classes
      phaseEl.classList.remove('active', 'completed');
      
      if (phaseIndex < currentIndex) {
        // Completed phases
        phaseEl.classList.add('completed');
      } else if (phaseIndex === currentIndex) {
        // Current active phase
        phaseEl.classList.add('active');
      }
      // Future phases remain without classes (dimmed)
    });
    
    // Update connectors
    connectors.forEach((connector, index) => {
      connector.classList.remove('active', 'completed');
      
      if (index < currentIndex) {
        connector.classList.add('completed');
      } else if (index === currentIndex - 1) {
        connector.classList.add('active');
      }
    });
  }
  
  // Reset phase indicators to initial state
  function resetPhaseIndicators() {
    const phasesContainer = document.getElementById('export-phases');
    if (!phasesContainer) return;
    
    phasesContainer.querySelectorAll('.export-phase').forEach(el => {
      el.classList.remove('active', 'completed');
    });
    phasesContainer.querySelectorAll('.phase-connector').forEach(el => {
      el.classList.remove('active', 'completed');
    });
  }
  
  // Set phase and update UI
  function setExportPhase(phase) {
    exportProgressState.phase = phase;
    logExport('info', 'Phase changed', {
      phase,
      currentSegment: exportProgressState.currentSegment,
      totalSegments: exportProgressState.totalSegments
    });
    updatePhaseIndicator(phase);
  }

  VE.loadFFmpeg = async function() {
    if (VE.state.ffmpegLoaded) return true;

    try {
      setExportPhase('loading');
      safeUpdateProgress(5, 'Loading FFmpeg...');
      
      if (!window.FFmpegWASM) {
        logExport('info', 'FFmpegWASM not yet loaded, injecting script');
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = '/static/libs/ffmpeg/ffmpeg.js';
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        });
      }
      
      safeUpdateProgress(8, 'Initializing encoder...');
      
      const { FFmpeg } = window.FFmpegWASM;
      VE.state.ffmpeg = new FFmpeg();
      
      // Note: We don't use FFmpeg's progress callback as it's unreliable
      // Instead we track progress based on completed segments
      
      const baseURL = '/static/libs/ffmpeg';
      await VE.state.ffmpeg.load({
        coreURL: `${baseURL}/ffmpeg-core.js`,
        wasmURL: `${baseURL}/ffmpeg-core.wasm`,
      });
      
      safeUpdateProgress(12, 'Encoder ready');
      VE.state.ffmpegLoaded = true;
      logExport('info', 'FFmpeg WASM loaded successfully', {
        baseURL,
        ffmpegLoaded: VE.state.ffmpegLoaded
      });
      return true;
    } catch (error) {
      logExport('error', 'FFmpeg load error', error);
      return false;
    }
  };

  // ============================================
  // Export Helper Functions
  // ============================================
  
  /**
   * Align time to frame boundary to prevent overlaps
   * Rounds time to nearest frame based on FPS
   */
  function alignToFrame(time, fps) {
    const frameInterval = 1 / fps;
    return Math.round(time / frameInterval) * frameInterval;
  }
  
  /**
   * Calculate exact segment duration aligned to frames to prevent overlap
   * Ensures endOffset aligns to frame boundary
   */
  function calculateSegmentDuration(startOffset, endOffset, fps) {
    // Align both start and end to frame boundaries
    const alignedStart = alignToFrame(startOffset, fps);
    const alignedEnd = alignToFrame(endOffset, fps);
    
    // Calculate duration from aligned times
    const duration = Math.max(0, alignedEnd - alignedStart);
    
    // Ensure minimum duration of at least one frame
    return Math.max(1 / fps, duration);
  }
  
  function segmentNeedsReencode(segment, asset, projW, projH) {
    // Text segments always need encoding
    if (segment.type === 'text') return true;
    
    // Images always need encoding
    if (asset.type === 'image') return true;
    
    // Check for crop
    if (segment.crop && segment.crop.width > 0 && segment.crop.height > 0) {
      return true;
    }
    
    // Check for transform (non-default position/scale)
    const transform = segment.transform || { x: 0, y: 0, scale: 100 };
    if (transform.x !== 0 || transform.y !== 0 || transform.scale !== 100) {
      return true;
    }
    
    // Dimension mismatch requires re-encode
    if (dimensionsDiffer(asset, projW, projH)) {
      return true;
    }
    
    // Filters can be applied during lightweight re-encode - don't force full re-encode here
    // Filters will be handled in a separate optimized path
    
    // NOTE: We use accurate output seeking (-ss after -i) for trimmed/split segments
    // instead of forcing re-encode. This is faster while still being accurate.
    
    return false;
  }
  
  // Check if asset dimensions differ from project (for logging/info purposes)
  function dimensionsDiffer(asset, projW, projH) {
    return asset.width !== projW || asset.height !== projH;
  }

  function hasActiveFilters() {
    const defaults = VE.filterPresets.none;
    return (
      VE.state.filters.brightness !== defaults.brightness ||
      VE.state.filters.contrast !== defaults.contrast ||
      VE.state.filters.saturation !== defaults.saturation ||
      VE.state.filters.hue !== defaults.hue ||
      VE.state.filters.blur !== defaults.blur ||
      VE.state.filters.vignette !== defaults.vignette
    );
  }

  // ============================================
  // Encoding Path Analyzer
  // Determines optimal encoding path before processing
  // ============================================
  
  /**
   * Encoding path types:
   * - 'stream-copy': Direct copy, no re-encoding (fastest)
   * - 'stream-copy-scale': Copy video, scale in separate pass
   * - 'fast-reencode': Re-encode with ultrafast preset
   * - 'full-reencode': Full re-encode with quality settings
   */
  const ENCODING_PATHS = {
    STREAM_COPY: 'stream-copy',
    STREAM_COPY_SCALE: 'stream-copy-scale',
    FAST_REENCODE: 'fast-reencode',
    FULL_REENCODE: 'full-reencode'
  };

  /**
   * Analyzes a segment and returns the optimal encoding path
   * @param {Object} segment - Timeline segment
   * @param {Object} asset - Associated asset
   * @param {number} projW - Project width
   * @param {number} projH - Project height
   * @returns {Object} EncodingPath with type, reason, preset, crf, and skipMethods
   */
  function analyzeEncodingPath(segment, asset, projW, projH) {
    const result = {
      type: ENCODING_PATHS.FULL_REENCODE,
      reason: '',
      preset: 'ultrafast',
      crf: 18,
      skipMethods: [],
      requiresScaling: false,
      hasFilters: hasActiveFilters(),
      isTrimmed: false
    };

    // Text segments always need full encoding
    if (segment.type === 'text') {
      result.type = ENCODING_PATHS.FULL_REENCODE;
      result.reason = 'Text segment requires rendering';
      result.skipMethods = ['stream-copy', 'stream-copy-scale'];
      logExport('info', 'Encoding path analysis', {
        segmentId: segment.id,
        path: result.type,
        reason: result.reason
      });
      return result;
    }

    // Images always need encoding
    if (asset && asset.type === 'image') {
      result.type = ENCODING_PATHS.FULL_REENCODE;
      result.reason = 'Image segment requires encoding to video';
      result.skipMethods = ['stream-copy', 'stream-copy-scale'];
      logExport('info', 'Encoding path analysis', {
        segmentId: segment.id,
        path: result.type,
        reason: result.reason
      });
      return result;
    }

    // Check for crop
    const hasCrop = segment.crop && segment.crop.width > 0 && segment.crop.height > 0;
    if (hasCrop) {
      result.type = ENCODING_PATHS.FULL_REENCODE;
      result.reason = 'Crop applied requires re-encoding';
      result.skipMethods = ['stream-copy', 'stream-copy-scale'];
      logExport('info', 'Encoding path analysis', {
        segmentId: segment.id,
        path: result.type,
        reason: result.reason,
        crop: segment.crop
      });
      return result;
    }

    // Check for transform (non-default position/scale)
    const transform = segment.transform || { x: 0, y: 0, scale: 100 };
    const hasTransform = transform.x !== 0 || transform.y !== 0 || transform.scale !== 100;
    if (hasTransform) {
      result.type = ENCODING_PATHS.FULL_REENCODE;
      result.reason = 'Transform applied requires re-encoding';
      result.skipMethods = ['stream-copy', 'stream-copy-scale'];
      logExport('info', 'Encoding path analysis', {
        segmentId: segment.id,
        path: result.type,
        reason: result.reason,
        transform
      });
      return result;
    }

    // Check for filters
    if (result.hasFilters) {
      result.type = ENCODING_PATHS.FAST_REENCODE;
      result.reason = 'Filters applied require re-encoding (using fast preset)';
      result.preset = 'veryfast';
      result.crf = 21;
      result.skipMethods = ['stream-copy'];
      logExport('info', 'Encoding path analysis', {
        segmentId: segment.id,
        path: result.type,
        reason: result.reason
      });
      return result;
    }

    // Check for trimming (startOffset > 0)
    const startOffset = segment.startOffset || 0;
    result.isTrimmed = startOffset > 0.1;

    // Check resolution match
    const assetW = asset?.width || projW;
    const assetH = asset?.height || projH;
    const resolutionMatches = assetW === projW && assetH === projH;

    if (resolutionMatches) {
      if (result.isTrimmed) {
        // Trimmed segment with matching resolution - use fast re-encode for accurate cuts
        result.type = ENCODING_PATHS.FAST_REENCODE;
        result.reason = 'Trimmed segment requires re-encode for accurate cut (resolution matches)';
        result.preset = 'ultrafast';
        result.crf = 18;
        result.skipMethods = ['stream-copy']; // Stream copy can't do accurate cuts
      } else {
        // Perfect match - use stream copy
        result.type = ENCODING_PATHS.STREAM_COPY;
        result.reason = 'Resolution matches, no transforms - using stream copy';
        result.skipMethods = [];
      }
    } else {
      // Resolution mismatch
      result.requiresScaling = true;
      if (result.isTrimmed) {
        // Trimmed + scaling - need fast re-encode
        result.type = ENCODING_PATHS.FAST_REENCODE;
        result.reason = `Resolution mismatch (${assetW}x${assetH} → ${projW}x${projH}) + trimmed - fast re-encode`;
        result.preset = 'ultrafast';
        result.crf = 23;
        result.skipMethods = ['stream-copy'];
      } else {
        // Just scaling needed - could use stream-copy-scale but for simplicity use fast re-encode
        result.type = ENCODING_PATHS.FAST_REENCODE;
        result.reason = `Resolution mismatch (${assetW}x${assetH} → ${projW}x${projH}) - fast re-encode with scaling`;
        result.preset = 'ultrafast';
        result.crf = 18;
        result.skipMethods = ['stream-copy'];
      }
    }

    logExport('info', 'Encoding path analysis', {
      segmentId: segment.id,
      path: result.type,
      reason: result.reason,
      assetResolution: `${assetW}x${assetH}`,
      projectResolution: `${projW}x${projH}`,
      resolutionMatches,
      isTrimmed: result.isTrimmed,
      preset: result.preset,
      crf: result.crf
    });

    return result;
  }

  /**
   * Get intermediate encoding settings (always fast for intermediate files)
   * @param {boolean} isTrimmed - Whether segment is trimmed
   * @param {string} segmentType - Type of segment (text, video, image)
   * @returns {Object} Encoding settings
   */
  function getIntermediateEncodingSettings(isTrimmed, segmentType) {
    // Always use ultrafast for intermediate files
    const settings = {
      preset: 'ultrafast',
      crf: isTrimmed ? 23 : 18, // Higher CRF for trimmed (speed), lower for quality-sensitive
      audioBitrate: '128k',
      fps: 24
    };

    // Text and images can use even faster settings
    if (segmentType === 'text' || segmentType === 'image') {
      settings.crf = 23;
    }

    return settings;
  }

  // ============================================
  // Audio Compatibility Checker
  // Determines if audio streams are compatible for stream copy concat
  // ============================================

  /**
   * Check if all segment audio streams are compatible for stream copy
   * @param {Array<Object>} segmentResults - Processed segment results with audio info
   * @returns {Object} Compatibility analysis
   */
  function checkAudioCompatibility(segmentResults) {
    const result = {
      compatible: true,
      reason: 'All audio streams compatible',
      sampleRates: new Set(),
      channelCounts: new Set(),
      codecs: new Set(),
      recommendedConcatMethod: 'stream-copy'
    };

    // If no segments or all segments have no audio, they're "compatible"
    const segmentsWithAudio = segmentResults.filter(s => s && s.hasAudio);
    if (segmentsWithAudio.length === 0) {
      result.reason = 'No audio streams to check';
      return result;
    }

    // For now, assume all our generated segments use consistent audio settings
    // (44100 Hz, stereo, AAC) since we control the encoding
    // This is a simplification - in a full implementation we'd probe each file
    
    // All our intermediate .ts files use:
    // - Sample rate: 44100
    // - Channels: 2 (stereo)
    // - Codec: AAC
    result.sampleRates.add(44100);
    result.channelCounts.add(2);
    result.codecs.add('aac');

    // Since we control encoding, audio should be compatible
    // The main issue is when source videos have different audio formats
    // but we re-encode to consistent AAC in intermediate files
    
    logExport('info', 'Audio compatibility check', {
      segmentCount: segmentResults.length,
      segmentsWithAudio: segmentsWithAudio.length,
      compatible: result.compatible,
      recommendedMethod: result.recommendedConcatMethod
    });

    return result;
  }

  // Export for testing
  VE.analyzeEncodingPath = analyzeEncodingPath;
  VE.getIntermediateEncodingSettings = getIntermediateEncodingSettings;
  VE.checkAudioCompatibility = checkAudioCompatibility;
  VE.ENCODING_PATHS = ENCODING_PATHS;

  async function prefetchAssetsForExport() {
    VE.state.prefetchedAssets.clear();
    
    // Collect asset IDs from all timelines (video, detached audio, custom audio)
    const assetIds = new Set();
    
    // Video timeline assets
    VE.state.timeline
      .filter(s => s.assetId)
      .forEach(s => assetIds.add(s.assetId));
    
    // Detached audio timeline assets
    VE.state.detachedAudioTimeline
      .filter(s => s.assetId)
      .forEach(s => assetIds.add(s.assetId));
    
    // Custom audio timeline assets
    VE.state.customAudioTimeline
      .filter(s => s.assetId)
      .forEach(s => assetIds.add(s.assetId));
    
    const fetchPromises = [];
    for (const assetId of assetIds) {
      const asset = VE.state.assets.find(a => a.id === assetId);
      if (asset && asset.objectUrl) {
        fetchPromises.push(
          fetch(asset.objectUrl)
            .then(r => r.arrayBuffer())
            .then(data => {
              VE.state.prefetchedAssets.set(assetId, new Uint8Array(data));
              logExport('info', 'Pre-fetched asset', {
                assetId,
                name: asset.name,
                type: asset.type,
                sizeBytes: data.byteLength
              });
            })
            .catch(err => logExport('warn', `Failed to prefetch asset ${assetId}`, err))
        );
      }
    }
    
    await Promise.all(fetchPromises);
    logExport('info', 'Finished prefetching assets', {
      prefetchedCount: VE.state.prefetchedAssets.size
    });
  }

  async function getAssetData(asset) {
    if (VE.state.prefetchedAssets.has(asset.id)) {
      // IMPORTANT: Return a COPY of the data, not the original reference.
      // FFmpeg's writeFile() transfers the ArrayBuffer to its Worker, which
      // "detaches" it. If we return the same reference, subsequent uses fail
      // with "ArrayBuffer is already detached" error.
      const cached = VE.state.prefetchedAssets.get(asset.id);
      return new Uint8Array(cached);
    }
    
    const response = await fetch(asset.objectUrl);
    return new Uint8Array(await response.arrayBuffer());
  }

  function updateProgressWithEta(progress, clipNum, totalClips) {
    // Ensure progress never goes backwards
    if (progress <= exportProgressState.lastProgressValue) {
      progress = exportProgressState.lastProgressValue + 0.1;
    }
    
    safeUpdateProgress(progress);
    
    VE.elements.progressText.textContent = `Encoding clip ${clipNum}/${totalClips}...`;
  }

  // ============================================
  // Audio Segment Processing for Export
  // ============================================
  async function processAudioSegmentForExport(segment, index, ffmpeg, audioBitrate, totalDuration) {
    logExport('info', 'Processing audio segment', { 
      index, 
      segmentId: segment.id, 
      assetId: segment.assetId,
      isDetachedAudio: segment.isDetachedAudio,
      sourceSegmentId: segment.sourceSegmentId,
      timelineStart: segment.timelineStart,
      startOffset: segment.startOffset,
      endOffset: segment.endOffset
    });
    
    const asset = VE.state.assets.find(a => a.id === segment.assetId);
    if (!asset) {
      logExport('warn', 'Skipping audio segment: no asset found', { index, segmentId: segment.id, assetId: segment.assetId });
      return null;
    }
    
    if (!asset.objectUrl) {
      logExport('warn', 'Skipping audio segment: asset has no objectUrl', { index, segmentId: segment.id, assetId: segment.assetId, assetName: asset.name });
      return null;
    }

    logExport('info', 'Found asset for audio segment', { 
      index, 
      assetId: asset.id, 
      assetType: asset.type,
      assetName: asset.name,
      assetObjectUrl: asset.objectUrl ? 'present' : 'missing',
      assetDuration: asset.duration
    });

    // Get asset data
    let inputData;
    try {
      inputData = await getAssetData(asset);
      if (!inputData || inputData.byteLength === 0) {
        logExport('error', 'Audio asset data is empty', { index, segmentId: segment.id });
        return null;
      }
      logExport('info', 'Fetched audio asset data', { index, sizeBytes: inputData.byteLength });
    } catch (fetchErr) {
      logExport('error', 'Failed to fetch audio asset for segment', { index, segmentId: segment.id, error: fetchErr.message || fetchErr });
      return null;
    }

    // Determine input file extension based on asset type
    // For detached audio from video, the asset is still a video file
    const isVideoAsset = asset.type === 'video';
    const inputFilename = `audio_input${index}.${isVideoAsset ? 'mp4' : getAudioExtension(asset.file?.type || 'audio/mp3')}`;
    
    try {
      await ffmpeg.writeFile(inputFilename, inputData);
      logExport('info', 'Wrote audio input file', { index, inputFilename, isVideoAsset, sizeBytes: inputData.byteLength });
    } catch (writeErr) {
      logExport('error', 'Failed to write audio input file', { index, inputFilename, error: writeErr.message || writeErr });
      return null;
    }

    const startOffset = segment.startOffset || 0;
    const endOffset = segment.endOffset || (asset.duration || 5);
    const duration = Math.max(0.1, endOffset - startOffset);
    
    // Use MP4 container for audio (more compatible than raw AAC)
    const outputFilename = `audio_seg${index}.mp4`;

    logExport('info', 'Audio segment timing', { 
      index, 
      startOffset, 
      endOffset, 
      duration,
      assetDuration: asset.duration
    });

    let extractionSuccessful = false;
    
    // Method 1: Extract audio to MP4 container (most compatible)
    logExport('info', 'Trying audio extraction method 1: MP4 container', { index });
    const extractArgs1 = [
      '-ss', startOffset.toFixed(3),
      '-i', inputFilename,
      '-t', duration.toFixed(3),
      '-vn',
      '-c:a', 'aac',
      '-b:a', audioBitrate,
      '-ar', '44100',
      '-ac', '2',
      '-y',
      outputFilename
    ];
    
    logExport('info', 'Method 1 args', { index, args: extractArgs1.join(' ') });
    
    try {
      await ffmpeg.exec(extractArgs1);
      const outputData = await ffmpeg.readFile(outputFilename);
      if (outputData && outputData.byteLength > 100) { // At least 100 bytes for valid audio
        logExport('info', 'Method 1 successful', { index, outputSize: outputData.byteLength });
        extractionSuccessful = true;
      }
    } catch (err) {
      logExport('warn', 'Method 1 failed', { index, error: err.message || String(err) });
    }
    
    // Method 2: Copy audio codec (faster, preserves original)
    if (!extractionSuccessful) {
      logExport('info', 'Trying audio extraction method 2: codec copy', { index });
      const extractArgs2 = [
        '-ss', startOffset.toFixed(3),
        '-i', inputFilename,
        '-t', duration.toFixed(3),
        '-vn',
        '-c:a', 'copy',
        '-y',
        outputFilename
      ];
      
      logExport('info', 'Method 2 args', { index, args: extractArgs2.join(' ') });
      
      try {
        await ffmpeg.exec(extractArgs2);
        const outputData = await ffmpeg.readFile(outputFilename);
        if (outputData && outputData.byteLength > 100) {
          logExport('info', 'Method 2 successful', { index, outputSize: outputData.byteLength });
          extractionSuccessful = true;
        }
      } catch (err) {
        logExport('warn', 'Method 2 failed', { index, error: err.message || String(err) });
      }
    }
    
    // Method 3: Extract full audio without trimming
    if (!extractionSuccessful) {
      logExport('info', 'Trying audio extraction method 3: full file', { index });
      const extractArgs3 = [
        '-i', inputFilename,
        '-vn',
        '-c:a', 'aac',
        '-b:a', audioBitrate,
        '-y',
        outputFilename
      ];
      
      logExport('info', 'Method 3 args', { index, args: extractArgs3.join(' ') });
      
      try {
        await ffmpeg.exec(extractArgs3);
        const outputData = await ffmpeg.readFile(outputFilename);
        if (outputData && outputData.byteLength > 100) {
          logExport('info', 'Method 3 successful (full file)', { index, outputSize: outputData.byteLength });
          extractionSuccessful = true;
        }
      } catch (err) {
        logExport('warn', 'Method 3 failed', { index, error: err.message || String(err) });
      }
    }
    
    // Method 4: Use map to explicitly select audio stream
    if (!extractionSuccessful) {
      logExport('info', 'Trying audio extraction method 4: explicit stream mapping', { index });
      const extractArgs4 = [
        '-i', inputFilename,
        '-map', '0:a:0',
        '-c:a', 'aac',
        '-b:a', audioBitrate,
        '-y',
        outputFilename
      ];
      
      logExport('info', 'Method 4 args', { index, args: extractArgs4.join(' ') });
      
      try {
        await ffmpeg.exec(extractArgs4);
        const outputData = await ffmpeg.readFile(outputFilename);
        if (outputData && outputData.byteLength > 100) {
          logExport('info', 'Method 4 successful', { index, outputSize: outputData.byteLength });
          extractionSuccessful = true;
        }
      } catch (err) {
        logExport('warn', 'Method 4 failed', { index, error: err.message || String(err) });
      }
    }
    
    // Cleanup input file
    try { await ffmpeg.deleteFile(inputFilename); } catch(e) {}
    
    if (!extractionSuccessful) {
      logExport('error', 'All audio extraction methods failed - video may have no audio track', { 
        index, 
        segmentId: segment.id,
        assetId: segment.assetId,
        isVideoAsset
      });
      try { await ffmpeg.deleteFile(outputFilename); } catch(e) {}
      return null;
    }

    return {
      filename: outputFilename,
      timelineStart: segment.timelineStart || 0,
      duration: duration
    };
  }

  function getAudioExtension(mimeType) {
    const extensions = {
      'audio/mpeg': 'mp3',
      'audio/mp3': 'mp3',
      'audio/wav': 'wav',
      'audio/wave': 'wav',
      'audio/ogg': 'ogg',
      'audio/aac': 'aac',
      'audio/m4a': 'm4a',
      'audio/flac': 'flac'
    };
    return extensions[mimeType] || 'mp3';
  }

  // Extract video audio that should be included (not detached)
  async function extractVideoAudioForExport(segment, index, ffmpeg, audioBitrate, segmentStartOnTimeline, totalDuration) {
    logExport('info', 'Attempting video audio extraction', { 
      index, 
      segmentId: segment.id,
      segmentType: segment.type,
      audioDetached: segment.audioDetached,
      segmentStartOnTimeline
    });
    
    // Skip if audio was detached
    if (segment.audioDetached) {
      logExport('info', 'Skipping video audio extraction, audio detached', { index, segmentId: segment.id });
      return null;
    }

    // Skip text segments
    if (segment.type === 'text') {
      logExport('info', 'Skipping video audio extraction, text segment', { index, segmentId: segment.id });
      return null;
    }

    const asset = VE.state.assets.find(a => a.id === segment.assetId);
    if (!asset) {
      logExport('warn', 'Skipping video audio extraction: asset not found', { index, segmentId: segment.id, assetId: segment.assetId });
      return null;
    }
    if (!asset.objectUrl) {
      logExport('warn', 'Skipping video audio extraction: no objectUrl', { index, segmentId: segment.id, assetId: asset.id });
      return null;
    }
    if (asset.type !== 'video') {
      logExport('info', 'Skipping video audio extraction: not a video asset', { index, segmentId: segment.id, assetType: asset.type });
      return null;
    }

    logExport('info', 'Found video asset for audio extraction', { 
      index, 
      assetId: asset.id, 
      assetName: asset.name,
      assetDuration: asset.duration
    });

    // Get asset data
    let inputData;
    try {
      inputData = await getAssetData(asset);
      logExport('info', 'Fetched video asset data for audio extraction', { index, sizeBytes: inputData.byteLength });
    } catch (fetchErr) {
      logExport('error', 'Failed to fetch video asset for audio extraction', { index, segmentId: segment.id, error: fetchErr });
      return null;
    }

    const inputFilename = `vid_audio_input${index}.mp4`;
    await ffmpeg.writeFile(inputFilename, inputData);
    logExport('info', 'Wrote video file for audio extraction', { index, inputFilename });

    const startOffset = segment.startOffset || 0;
    const endOffset = segment.endOffset || (asset.duration || 5);
    const duration = Math.max(0.1, endOffset - startOffset);
    const outputFilename = `vid_audio_seg${index}.aac`;

    // Extract audio from video segment (simplified - no positioning)
    const extractArgs = [
      '-ss', startOffset.toFixed(3),
      '-i', inputFilename,
      '-t', duration.toFixed(3),
      '-vn',
      '-c:a', 'aac',
      '-b:a', audioBitrate,
      '-ar', '44100',
      '-ac', '2',
      outputFilename
    ];

    logExport('info', 'Extracting video audio with args', { index, args: extractArgs.join(' ') });

    try {
      await ffmpeg.exec(extractArgs);
      logExport('info', 'Video audio extraction successful', { index, outputFilename });
    } catch (err) {
      logExport('warn', 'No audio track in video segment or extraction failed', { index, segmentId: segment.id, error: err });
      try { await ffmpeg.deleteFile(inputFilename); } catch(e) {}
      return null;
    }

    // Cleanup input file
    try { await ffmpeg.deleteFile(inputFilename); } catch(e) {}

    return {
      filename: outputFilename,
      timelineStart: segmentStartOnTimeline,
      duration: duration
    };
  }

  // Helper function to log encoding progress with frame information
  function logEncodingProgress(segment, index, duration, fps, stage = 'start') {
    const totalFrames = Math.ceil(duration * fps);
    if (stage === 'start') {
      logExport('info', `Starting encoding segment ${index + 1}`, {
        index,
        segmentId: segment.id,
        duration: duration.toFixed(3),
        fps,
        totalFrames,
        note: `Encoding ${totalFrames} frames (${duration.toFixed(2)}s at ${fps}fps)`
      });
    } else if (stage === 'complete') {
      logExport('info', `Completed encoding segment ${index + 1}`, {
        index,
        segmentId: segment.id,
        totalFrames,
        duration: duration.toFixed(3),
        note: `Successfully encoded ${totalFrames} frames`
      });
    }
  }

  async function processSegmentForExport(segment, index, ffmpeg, projW, projH, qualitySettings) {
    const { audioBitrate, fps } = qualitySettings;
    
    // Get asset for analysis (may be null for text segments)
    const asset = segment.type !== 'text' ? VE.state.assets.find(a => a.id === segment.assetId) : null;
    
    // Analyze encoding path BEFORE any encoding attempt
    const encodingPath = analyzeEncodingPath(segment, asset, projW, projH);
    
    // Get optimized intermediate encoding settings
    const startOffset = segment.startOffset || 0;
    const isTrimmed = startOffset > 0.1;
    const intermediateSettings = getIntermediateEncodingSettings(isTrimmed, segment.type);
    
    // Use intermediate settings for faster encoding (ultrafast preset)
    const effectivePreset = intermediateSettings.preset;
    const effectiveCrf = intermediateSettings.crf;
    
    logExport('info', 'Using optimized encoding settings', {
      segmentId: segment.id,
      encodingPath: encodingPath.type,
      reason: encodingPath.reason,
      preset: effectivePreset,
      crf: effectiveCrf,
      skipMethods: encodingPath.skipMethods
    });
    
    if (segment.type === 'text') {
      // Create text frame at project resolution with silent audio
      const canvas = document.createElement('canvas');
      canvas.width = projW;
      canvas.height = projH;
      const ctx = canvas.getContext('2d');
      
      ctx.fillStyle = segment.bgColor || '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      ctx.fillStyle = segment.color || '#fff';
      const fontSize = (segment.fontSize || 48) * 2;
      ctx.font = `bold ${fontSize}px ${segment.font || 'DM Sans'}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      
      const lines = (segment.text || 'Text').split('\n');
      const lineHeight = fontSize * 1.25;
      const startY = canvas.height / 2 - ((lines.length - 1) * lineHeight) / 2;
      
      lines.forEach((line, idx) => {
        ctx.fillText(line, canvas.width / 2, startY + idx * lineHeight);
      });
      
      // Convert canvas to PNG bytes
      const imageDataUrl = canvas.toDataURL('image/png');
      const imageBase64 = imageDataUrl.split(',')[1];
      const imageBytes = Uint8Array.from(atob(imageBase64), c => c.charCodeAt(0));
      
      const pngFilename = `text${index}.png`;
      await ffmpeg.writeFile(pngFilename, imageBytes);
      
      const duration = Math.max(0.1, (segment.endOffset || 3) - (segment.startOffset || 0));
      const segmentFilename = `segment${index}.ts`;
      
      // CRITICAL: Include silent audio track for text segments to maintain audio continuity
      // This prevents audio sync issues when concatenating video+text+video segments
      // Use ultrafast preset for text segments (speed optimization)
      await ffmpeg.exec([
        '-loop', '1', 
        '-i', pngFilename,
        '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', // Silent audio source
        '-t', duration.toFixed(3),
        '-vf', `scale=${projW}:${projH}:force_original_aspect_ratio=decrease,pad=${projW}:${projH}:(ow-iw)/2:(oh-ih)/2:black`,
        '-c:v', 'libx264', '-preset', effectivePreset, '-crf', effectiveCrf.toString(), '-pix_fmt', 'yuv420p', '-r', fps.toString(),
        '-c:a', 'aac', '-b:a', '128k', // Include audio codec for silent track
        '-shortest',
        '-f', 'mpegts', segmentFilename
      ]);
      
      // Clean up PNG immediately
      try { await ffmpeg.deleteFile(pngFilename); } catch(e) {}
      
      return { filename: segmentFilename, hasAudio: true };
    }
    
    if (segment.type === 'image') {
      // Create image frame at project resolution with silent audio
      const asset = VE.state.assets.find(a => a.id === segment.assetId);
      if (!asset || !asset.objectUrl) {
        logExport('warn', 'Skipping image segment: no asset found', { index, segmentId: segment.id });
        return null;
      }
      
      // Fetch image data
      let imageData;
      try {
        const response = await fetch(asset.objectUrl);
        imageData = await response.arrayBuffer();
      } catch (fetchErr) {
        logExport('error', 'Failed to fetch image for image segment', { index, segmentId: segment.id, error: fetchErr });
        return null;
      }
      
      const imageFilename = `image${index}.png`;
      await ffmpeg.writeFile(imageFilename, new Uint8Array(imageData));
      
      const duration = Math.max(0.1, (segment.endOffset || 3) - (segment.startOffset || 0));
      const segmentFilename = `segment${index}.ts`;
      
      // CRITICAL: Include silent audio track for image segments to maintain audio continuity
      // Use ultrafast preset for image segments (speed optimization)
      await ffmpeg.exec([
        '-loop', '1', 
        '-i', imageFilename,
        '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', // Silent audio source
        '-t', duration.toFixed(3),
        '-vf', `scale=${projW}:${projH}:force_original_aspect_ratio=decrease,pad=${projW}:${projH}:(ow-iw)/2:(oh-ih)/2:black`,
        '-c:v', 'libx264', '-preset', effectivePreset, '-crf', effectiveCrf.toString(), '-pix_fmt', 'yuv420p', '-r', fps.toString(),
        '-c:a', 'aac', '-b:a', '128k', // Include audio codec for silent track
        '-shortest',
        '-f', 'mpegts', segmentFilename
      ]);
      
      // Clean up image file immediately
      try { await ffmpeg.deleteFile(imageFilename); } catch(e) {}
      
      return { filename: segmentFilename, hasAudio: true };
    }
    
    // Video/Image segment - asset was already retrieved above for analysis
    if (!asset || !asset.objectUrl) {
      logExport('warn', 'Skipping video/image segment: no asset found', { index, segmentId: segment.id });
      return null;
    }

    // Get asset data (from prefetch cache or fetch)
    let inputData;
    try {
      inputData = await getAssetData(asset);
    } catch (fetchErr) {
      logExport('error', 'Failed to fetch asset for video/image segment', { index, segmentId: segment.id, error: fetchErr });
      return null;
    }
    
    // Use unique filename per segment to avoid conflicts when same asset is used multiple times
    const inputFilename = `input${index}_${segment.id}.${asset.type === 'image' ? 'png' : 'mp4'}`;
    await ffmpeg.writeFile(inputFilename, inputData);

    // Calculate precise start, end, and duration to prevent overlaps
    // CRITICAL: Use the segment's specific startOffset and endOffset 
    // These values are set correctly when segments are split
    const endOffset = segment.endOffset || (asset.duration || 5);
    const duration = Math.max(0.1, endOffset - startOffset);
    const segmentFilename = `segment${index}.ts`;
    
    // Log encoding start with frame information (only for video/image segments, not text)
    if (segment.type !== 'text') {
      logEncodingProgress(segment, index, duration, fps, 'start');
    }
    
    logExport('info', 'Processing segment with timing', {
      index,
      segmentId: segment.id,
      assetId: asset.id,
      startOffset,
      endOffset,
      duration,
      note: 'These offsets ensure split segments play their correct portion'
    });
    
    // Use the pre-analyzed encoding path instead of re-checking
    const needsReencode = encodingPath.type === ENCODING_PATHS.FULL_REENCODE;
    const shouldSkipStreamCopy = encodingPath.skipMethods.includes('stream-copy');
    
    // ONLY include original embedded audio for video assets when audio has NOT been detached.
    // If audio was detached, the video segment should be silent and any audio comes from
    // the detached/custom audio timelines instead.
    const wantsAudio = asset.type === 'video' && !segment.audioDetached;
    
    // Use the analyzed encoding path for logging
    const isTrimmedSegment = isTrimmed;
    const hasFilters = encodingPath.hasFilters;
    
    logExport('info', 'Processing video/image segment', {
      index,
      segmentId: segment.id,
      assetType: asset.type,
      audioDetached: segment.audioDetached,
      wantsAudio,
      needsReencode,
      shouldSkipStreamCopy,
      isTrimmedSegment,
      startOffset,
      endOffset,
      duration,
      encodingPathType: encodingPath.type,
      encodingPathReason: encodingPath.reason
    });

    // Track if we successfully included audio
    let hasAudio = false;
    
    // FAST PATH: Stream copy - only when analyzer says it's safe
    // Skip if the analyzer determined stream copy won't work
    if (!shouldSkipStreamCopy && encodingPath.type === ENCODING_PATHS.STREAM_COPY && asset.type === 'video' && wantsAudio) {
      logExport('info', 'Attempting stream copy (analyzer approved)', {
        index,
        segmentId: segment.id,
        startOffset,
        wantsAudio,
        encodingPathType: encodingPath.type
      });
      
      // Method 1: Full stream copy (video + audio copy)
      try {
        const streamCopyArgs = [
          '-i', inputFilename,
          '-t', duration.toFixed(3),
          '-c:v', 'copy',
          '-c:a', 'copy',
          '-avoid_negative_ts', 'make_zero',
          '-f', 'mpegts', segmentFilename
        ];
        
        logExport('info', 'Stream copy args (video+audio copy)', { args: streamCopyArgs.join(' ') });
        await ffmpeg.exec(streamCopyArgs);
        
        const outputData = await ffmpeg.readFile(segmentFilename);
        if (outputData && outputData.byteLength > 100) {
          try { await ffmpeg.deleteFile(inputFilename); } catch(e) {}
          logEncodingProgress(segment, index, duration, fps, 'complete');
          logExport('info', 'Stream copy succeeded (video+audio copy)', { index, segmentId: segment.id, outputSize: outputData.byteLength });
          return { filename: segmentFilename, hasAudio: true };
        }
      } catch (err1) {
        logExport('warn', 'Stream copy (video+audio copy) failed', { index, error: err1.message || String(err1) });
      }
      
      // Method 2: Video copy + audio re-encode (for incompatible audio codecs)
      try {
        const streamCopyArgs2 = [
          '-i', inputFilename,
          '-t', duration.toFixed(3),
          '-c:v', 'copy',
          '-c:a', 'aac', '-b:a', audioBitrate, '-ar', '44100', '-ac', '2',
          '-avoid_negative_ts', 'make_zero',
          '-f', 'mpegts', segmentFilename
        ];
          
        logExport('info', 'Stream copy args (video copy, audio re-encode)', { args: streamCopyArgs2.join(' ') });
        await ffmpeg.exec(streamCopyArgs2);
          
        const outputData = await ffmpeg.readFile(segmentFilename);
        if (outputData && outputData.byteLength > 100) {
          try { await ffmpeg.deleteFile(inputFilename); } catch(e) {}
          logExport('info', 'Stream copy succeeded (video copy, audio re-encoded)', { index, segmentId: segment.id, outputSize: outputData.byteLength });
          return { filename: segmentFilename, hasAudio: true };
        }
      } catch (err2) {
        logExport('warn', 'Stream copy (video copy, audio re-encode) failed', { index, error: err2.message || String(err2) });
      }
      
      // Method 3: Video copy + SILENT audio (source has no audio track)
      try {
        const streamCopyArgs3 = [
          '-i', inputFilename,
          '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
          '-t', duration.toFixed(3),
          '-c:v', 'copy',
          '-c:a', 'aac', '-b:a', '128k',
          '-map', '0:v:0',
          '-map', '1:a:0',
          '-shortest',
          '-avoid_negative_ts', 'make_zero',
          '-f', 'mpegts', segmentFilename
        ];
              
        logExport('info', 'Stream copy args (video copy, silent audio)', { args: streamCopyArgs3.join(' ') });
        await ffmpeg.exec(streamCopyArgs3);
              
        const outputData = await ffmpeg.readFile(segmentFilename);
        if (outputData && outputData.byteLength > 100) {
          try { await ffmpeg.deleteFile(inputFilename); } catch(e) {}
          logExport('info', 'Stream copy succeeded (video copy, added silent audio)', { index, segmentId: segment.id, outputSize: outputData.byteLength });
          return { filename: segmentFilename, hasAudio: true };
        }
      } catch (err3) {
        logExport('warn', 'Stream copy with silent audio failed, falling back to re-encode', { index, error: err3.message || String(err3) });
      }
    }
    
    // FAST RE-ENCODE PATH: For trimmed/split segments or when analyzer recommends fast re-encode
    // This is necessary because stream copy cannot make frame-accurate cuts (only keyframe cuts)
    // Also applies filters if present (filters can be applied during re-encode)
    if (encodingPath.type === ENCODING_PATHS.FAST_REENCODE && asset.type === 'video') {
      logExport('info', 'Using fast re-encode (analyzer recommended)', {
        index,
        segmentId: segment.id,
        startOffset,
        duration,
        hasFilters,
        wantsAudio,
        audioDetached: segment.audioDetached,
        encodingPathReason: encodingPath.reason,
        note: 'Using optimized intermediate settings for speed'
      });
      
      // Use intermediate settings for speed - always ultrafast for intermediate files
      const fastPreset = effectivePreset; // From intermediate settings (ultrafast)
      const fastCrf = effectiveCrf; // From intermediate settings (18 or 23)
      
      // Get filter string if filters are active
      const colorFilterString = hasFilters ? VE.getFFmpegFilterString() : null;
      
      // Only try to include original audio if audio was NOT detached
      if (wantsAudio) {
        try {
          const fastReencodeArgs = [
            '-ss', startOffset.toFixed(3),
            '-i', inputFilename,
            '-t', duration.toFixed(3),
          ];
          
          // Apply filters if any
          if (colorFilterString) {
            fastReencodeArgs.push('-vf', colorFilterString);
          }
          
          fastReencodeArgs.push(
            '-c:v', 'libx264', '-preset', fastPreset, '-crf', fastCrf.toString(),
            '-pix_fmt', 'yuv420p', '-r', fps.toString(),
            '-c:a', 'aac', '-b:a', audioBitrate, '-ar', '44100', '-ac', '2',
            '-avoid_negative_ts', 'make_zero',
            '-f', 'mpegts', segmentFilename
          );
          
          logExport('info', 'Fast re-encode args (with original audio)' + (hasFilters ? ' (with filters)' : ''), { args: fastReencodeArgs.join(' ') });
          await ffmpeg.exec(fastReencodeArgs);
          
          const outputData = await ffmpeg.readFile(segmentFilename);
          if (outputData && outputData.byteLength > 100) {
            try { await ffmpeg.deleteFile(inputFilename); } catch(e) {}
            logEncodingProgress(segment, index, duration, fps, 'complete');
            logExport('info', 'Fast re-encode succeeded with original audio', { index, segmentId: segment.id, outputSize: outputData.byteLength });
            return { filename: segmentFilename, hasAudio: true };
          }
        } catch (fastErr) {
          logExport('warn', 'Fast re-encode with original audio failed, trying with silent audio', { index, error: fastErr.message || String(fastErr) });
        }
      } else {
        logExport('info', 'Skipping original audio in fast re-encode (audio detached)', { index, segmentId: segment.id, audioDetached: segment.audioDetached });
      }
      
      // Fallback/default: fast re-encode with silent audio (used when wantsAudio is false OR original audio failed)
      try {
        const fastReencodeArgs2 = [
          '-ss', startOffset.toFixed(3),
          '-i', inputFilename,
          '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
          '-t', duration.toFixed(3),
        ];
        
        // Apply filters if any
        if (colorFilterString) {
          fastReencodeArgs2.push('-vf', colorFilterString);
        }
        
        fastReencodeArgs2.push(
          '-c:v', 'libx264', '-preset', fastPreset, '-crf', fastCrf.toString(),
          '-pix_fmt', 'yuv420p', '-r', fps.toString(),
          '-c:a', 'aac', '-b:a', '128k',
          '-map', '0:v:0',
          '-map', '1:a:0',
          '-shortest',
          '-avoid_negative_ts', 'make_zero',
          '-f', 'mpegts', segmentFilename
        );
        
        logExport('info', 'Fast re-encode args (silent audio)' + (hasFilters ? ' (with filters)' : ''), { args: fastReencodeArgs2.join(' ') });
        await ffmpeg.exec(fastReencodeArgs2);
        
        const outputData = await ffmpeg.readFile(segmentFilename);
        if (outputData && outputData.byteLength > 100) {
          try { await ffmpeg.deleteFile(inputFilename); } catch(e) {}
          logExport('info', 'Fast re-encode with silent audio succeeded', { index, segmentId: segment.id, outputSize: outputData.byteLength, audioDetached: segment.audioDetached === true });
          return { filename: segmentFilename, hasAudio: true };
        }
      } catch (fastErr2) {
        logExport('warn', 'Fast re-encode with silent audio failed', { index, error: fastErr2.message || String(fastErr2) });
      }
    }
    
    // OPTIMIZED PATH: Lightweight re-encode for filters-only segments (no crop/transform/dimension changes)
    // This is much faster than full re-encode while still allowing filters to be applied
    if (!needsReencode && asset.type === 'video' && hasActiveFilters() && !isTrimmedSegment) {
      logExport('info', 'Using lightweight re-encode for filters-only segment', {
        index,
        segmentId: segment.id,
        wantsAudio,
        audioDetached: segment.audioDetached,
        note: 'Filters can be applied with fast preset, avoiding full re-encode'
      });
      
      // Use faster preset for speed - quality is still good for intermediate files
      const filterPreset = 'veryfast'; // Faster than default but still good quality
      const filterCrf = 21; // Slightly higher CRF for speed, minimal quality loss
      
      // Get filter string
      const colorFilterString = VE.getFFmpegFilterString();
      
      // Only try to include original audio if audio was NOT detached
      if (wantsAudio) {
        try {
          const filterReencodeArgs = [
            '-i', inputFilename,
            '-t', duration.toFixed(3),
          ];
          
          // Apply filters if any
          if (colorFilterString) {
            filterReencodeArgs.push('-vf', colorFilterString);
          }
          
          filterReencodeArgs.push(
            '-c:v', 'libx264', '-preset', filterPreset, '-crf', filterCrf.toString(),
            '-pix_fmt', 'yuv420p', '-r', fps.toString(),
            '-c:a', 'aac', '-b:a', audioBitrate, '-ar', '44100', '-ac', '2',
            '-avoid_negative_ts', 'make_zero',
            '-f', 'mpegts', segmentFilename
          );
          
          logExport('info', 'Filter-only re-encode args (with original audio)', { args: filterReencodeArgs.join(' ') });
          await ffmpeg.exec(filterReencodeArgs);
          
          const outputData = await ffmpeg.readFile(segmentFilename);
          if (outputData && outputData.byteLength > 100) {
            try { await ffmpeg.deleteFile(inputFilename); } catch(e) {}
            logEncodingProgress(segment, index, duration, fps, 'complete');
            logExport('info', 'Filter-only re-encode succeeded with original audio', { index, segmentId: segment.id, outputSize: outputData.byteLength });
            return { filename: segmentFilename, hasAudio: true };
          }
        } catch (filterErr) {
          logExport('warn', 'Filter-only re-encode with original audio failed, trying with silent audio', { index, error: filterErr.message || String(filterErr) });
        }
      } else {
        logExport('info', 'Skipping original audio in filter-only re-encode (audio detached)', { index, segmentId: segment.id, audioDetached: segment.audioDetached });
      }
      
      // Fallback/default: filter re-encode with silent audio (used when wantsAudio is false OR original audio failed)
      try {
        const filterReencodeArgs2 = [
          '-i', inputFilename,
          '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
          '-t', duration.toFixed(3),
        ];
        
        // Apply filters if any
        if (colorFilterString) {
          filterReencodeArgs2.push('-vf', colorFilterString);
        }
        
        filterReencodeArgs2.push(
          '-c:v', 'libx264', '-preset', filterPreset, '-crf', filterCrf.toString(),
          '-pix_fmt', 'yuv420p', '-r', fps.toString(),
          '-c:a', 'aac', '-b:a', '128k',
          '-map', '0:v:0',
          '-map', '1:a:0',
          '-shortest',
          '-avoid_negative_ts', 'make_zero',
          '-f', 'mpegts', segmentFilename
        );
        
        logExport('info', 'Filter-only re-encode args (silent audio)', { args: filterReencodeArgs2.join(' ') });
        await ffmpeg.exec(filterReencodeArgs2);
        
        const outputData = await ffmpeg.readFile(segmentFilename);
        if (outputData && outputData.byteLength > 100) {
          try { await ffmpeg.deleteFile(inputFilename); } catch(e) {}
          logExport('info', 'Filter-only re-encode with silent audio succeeded', { index, segmentId: segment.id, outputSize: outputData.byteLength, audioDetached: segment.audioDetached === true });
          return { filename: segmentFilename, hasAudio: true };
        }
      } catch (filterErr2) {
        logExport('warn', 'Filter-only re-encode with silent audio failed, falling back to full re-encode', { index, error: filterErr2.message || String(filterErr2) });
      }
    }
    
    // SLOW PATH: Full re-encoding with filters (and optional audio)
    const hasDimensionMismatch = dimensionsDiffer(asset, projW, projH);
    logExport('info', 'Re-encoding segment with filters', {
      index,
      segmentId: segment.id,
      hasCrop: !!segment.crop,
      hasTransform: !!segment.transform,
      hasFilters: hasActiveFilters(),
      hasDimensionMismatch,
      wantsAudio,
      note: 'Re-encoding will increase file size - this is expected when applying transformations'
    });
    
    // Build video filter chain
    const videoFilters = [];
    
    // Crop if specified
    if (segment.crop && segment.crop.width > 0 && segment.crop.height > 0) {
      const { x, y, width, height } = segment.crop;
      videoFilters.push(`crop=${Math.round(width)}:${Math.round(height)}:${Math.round(x)}:${Math.round(y)}`);
    }
    
    // Scale and position
    const transform = segment.transform || { x: 0, y: 0, scale: 100 };
    const sourceW = segment.crop?.width || asset.width || projW;
    const sourceH = segment.crop?.height || asset.height || projH;
    
    // Calculate dimensions to fit within project while maintaining aspect ratio
    const scaleRatio = Math.min(projW / sourceW, projH / sourceH) * (transform.scale / 100);
    const scaledW = Math.round(sourceW * scaleRatio);
    const scaledH = Math.round(sourceH * scaleRatio);
    
    // Ensure even dimensions (required for h264)
    const evenW = scaledW % 2 === 0 ? scaledW : scaledW + 1;
    const evenH = scaledH % 2 === 0 ? scaledH : scaledH + 1;
    
    videoFilters.push(`scale=${evenW}:${evenH}`);
    
    // Pad to project resolution and position
    const padX = Math.max(0, Math.round((projW - evenW) / 2 + transform.x));
    const padY = Math.max(0, Math.round((projH - evenH) / 2 + transform.y));
    videoFilters.push(`pad=${projW}:${projH}:${padX}:${padY}:black`);
    
    // Apply color filters if any
    const colorFilterString = VE.getFFmpegFilterString();
    if (colorFilterString) {
      videoFilters.push(colorFilterString);
    }
    
    const vfString = videoFilters.join(',');
    
    // Method 1: Re-encode with original audio (only when we actually want embedded audio)
    // Use intermediate settings (ultrafast) for speed optimization
    if (asset.type === 'video') {
      if (wantsAudio) {
        try {
          const reencodeWithAudio = [
            '-ss', startOffset.toFixed(3),
            '-i', inputFilename,
            '-t', duration.toFixed(3),
            '-vf', vfString,
            '-c:v', 'libx264', '-preset', effectivePreset, '-crf', effectiveCrf.toString(), '-pix_fmt', 'yuv420p', '-r', fps.toString(),
            '-c:a', 'aac', '-b:a', audioBitrate, '-ar', '44100', '-ac', '2',
            '-f', 'mpegts', segmentFilename
          ];
          
          logExport('info', 'Re-encode args (with audio)', { args: reencodeWithAudio.join(' ') });
          await ffmpeg.exec(reencodeWithAudio);
          
          const outputData = await ffmpeg.readFile(segmentFilename);
          if (outputData && outputData.byteLength > 100) {
            try { await ffmpeg.deleteFile(inputFilename); } catch(e) {}
            logEncodingProgress(segment, index, duration, fps, 'complete');
            logExport('info', 'Re-encode successful with audio', { index, outputSize: outputData.byteLength });
            return { filename: segmentFilename, hasAudio: true };
          }
        } catch (reencodeErr) {
          logExport('warn', 'Re-encode with audio failed', { index, error: reencodeErr.message || String(reencodeErr) });
        }
      }
      
      // Method 2: Re-encode video + add SILENT audio
      // Used either when the source has no usable audio, or when audio has been detached
      // and we explicitly want the video segment itself to be silent.
      // Use intermediate settings (ultrafast) for speed optimization
      try {
        const reencodeWithSilence = [
          '-ss', startOffset.toFixed(3),
          '-i', inputFilename,
          '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
          '-t', duration.toFixed(3),
          '-vf', vfString,
          '-c:v', 'libx264', '-preset', effectivePreset, '-crf', effectiveCrf.toString(), '-pix_fmt', 'yuv420p', '-r', fps.toString(),
          '-c:a', 'aac', '-b:a', '128k',
          '-map', '0:v:0',
          '-map', '1:a:0',
          '-shortest',
          '-f', 'mpegts', segmentFilename
        ];
        
        logExport('info', 'Re-encode args (with silent audio)', { args: reencodeWithSilence.join(' ') });
        await ffmpeg.exec(reencodeWithSilence);
        
        const outputData = await ffmpeg.readFile(segmentFilename);
        if (outputData && outputData.byteLength > 100) {
          try { await ffmpeg.deleteFile(inputFilename); } catch(e) {}
          logEncodingProgress(segment, index, duration, fps, 'complete');
          logExport('info', 'Re-encode successful with silent audio', { index, outputSize: outputData.byteLength, audioDetached: segment.audioDetached === true });
          // Even though the track is silent, from concat/mixing perspective this segment "has audio".
          return { filename: segmentFilename, hasAudio: true };
        }
      } catch (reencodeErr2) {
        logExport('warn', 'Re-encode with silent audio failed', { index, error: reencodeErr2.message || String(reencodeErr2) });
      }
    }
    
    // For images: always include silent audio
    // Use intermediate settings (ultrafast) for speed optimization
    if (asset.type === 'image') {
      try {
        const imageWithSilence = [
          '-loop', '1',
          '-i', inputFilename,
          '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
          '-t', duration.toFixed(3),
          '-vf', vfString,
          '-c:v', 'libx264', '-preset', effectivePreset, '-crf', effectiveCrf.toString(), '-pix_fmt', 'yuv420p', '-r', fps.toString(),
          '-c:a', 'aac', '-b:a', '128k',
          '-shortest',
          '-f', 'mpegts', segmentFilename
        ];
        
        logExport('info', 'Image encode args (with silent audio)', { args: imageWithSilence.join(' ') });
        await ffmpeg.exec(imageWithSilence);
        
        const outputData = await ffmpeg.readFile(segmentFilename);
        if (outputData && outputData.byteLength > 100) {
          try { await ffmpeg.deleteFile(inputFilename); } catch(e) {}
          logEncodingProgress(segment, index, duration, fps, 'complete');
          logExport('info', 'Image encode successful with silent audio', { index, outputSize: outputData.byteLength });
          return { filename: segmentFilename, hasAudio: true };
        }
      } catch (imageErr) {
        logExport('warn', 'Image encode with silent audio failed', { index, error: imageErr.message || String(imageErr) });
      }
    }
    
    // LAST RESORT: Video-only without audio (will cause audio sync issues, but better than failing)
    // This is the guaranteed fallback that prioritizes completion over quality
    logExport('warn', 'All audio methods failed, falling back to video-only (WILL CAUSE AUDIO ISSUES)', { index });
    
    try {
      // Use ultrafast preset for guaranteed completion
      const videoOnlyArgs = asset.type === 'image' 
        ? [
            '-loop', '1',
            '-i', inputFilename,
            '-t', duration.toFixed(3),
            '-vf', vfString,
            '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p', '-r', fps.toString(),
            '-an',
            '-f', 'mpegts', segmentFilename
          ]
        : [
            '-ss', startOffset.toFixed(3),
            '-i', inputFilename,
            '-t', duration.toFixed(3),
            '-vf', vfString,
            '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p', '-r', fps.toString(),
            '-an',
            '-f', 'mpegts', segmentFilename
          ];
      
      logExport('info', 'Video-only encode args (no audio - LAST RESORT)', { args: videoOnlyArgs.join(' ') });
      await ffmpeg.exec(videoOnlyArgs);
      
    try { await ffmpeg.deleteFile(inputFilename); } catch(e) {}
      logExport('warn', 'Video-only encode succeeded (NO AUDIO - will cause sync issues)', { index });
      return { filename: segmentFilename, hasAudio: false };
    } catch (lastResortErr) {
      logExport('error', 'All encode attempts failed for segment', { index, segmentId: segment.id, error: lastResortErr.message || String(lastResortErr) });
    }
    
    // Clean up input file
    try { await ffmpeg.deleteFile(inputFilename); } catch(e) {}
    
      return null;
  }

  async function exportWithFFmpeg() {
    VE.elements.startExportBtn.disabled = true;
    VE.state.exportStartTime = Date.now();
    
    // Reset progress state
    exportProgressState.currentSegment = 0;
    exportProgressState.totalSegments = VE.state.timeline.length;
    exportProgressState.lastProgressValue = 0;
    exportProgressState.isExporting = true;
    
    setProgressBar(0);
    setExportPhase('prefetch');
    safeUpdateProgress(12, 'Preparing export...');
    
    // Get quality settings
    const qualityPreset = VE.exportQualityPresets[VE.state.exportQuality] || VE.exportQualityPresets.standard;
    const { preset, crf, audioBitrate, fps, twoPass, parallelSegments } = qualityPreset;
    
    // Track all files created for cleanup
    const allCreatedFiles = [];

    try {
      const ffmpeg = VE.state.ffmpeg;
      const format = VE.elements.exportFormat.value;
      const projW = VE.state.exportResolution.width;
      const projH = VE.state.exportResolution.height;
    
      logExport('info', 'Starting FFmpeg export', {
        exportQuality: VE.state.exportQuality,
        qualityPreset,
        exportFormat: format,
        projectResolution: `${projW}x${projH}`,
        exportResolution: `${VE.state.exportResolution.width}x${VE.state.exportResolution.height}`,
        timelineSegments: VE.state.timeline.length,
        hasFilters: hasActiveFilters(),
        note: 'Stream copy will be used when possible to preserve original quality and file size'
      });

      // Phase 1: Pre-fetch all assets (12-18%)
      safeUpdateProgress(14, 'Pre-fetching assets...');
      await prefetchAssetsForExport();
      safeUpdateProgress(18, 'Assets loaded');
      
      // Calculate total duration (max of video timeline and audio timelines)
      VE.updateTotalDuration();
      VE.updateAudioDuration();
      const totalDuration = Math.max(VE.state.totalDuration, VE.state.audioDuration);
      logExport('info', 'Computed total export duration', {
        totalDuration,
        videoDuration: VE.state.totalDuration,
        audioDuration: VE.state.audioDuration
      });
      
      // Phase 2: Process video segments (18-55%)
      setExportPhase('segments');
      const segmentFiles = [];
      const segmentResults = []; // Track {filename, hasAudio} for each segment
      const totalClips = VE.state.timeline.length;
      
      // Calculate timeline positions for video segments (for audio extraction)
      const videoSegmentPositions = [];
      let videoTimelinePosition = 0;
      VE.state.timeline.forEach((segment, index) => {
        videoSegmentPositions.push(videoTimelinePosition);
        videoTimelinePosition += (segment.endOffset - segment.startOffset);
      });
      
      // Track encoding stats for user feedback
      let streamCopyCount = 0;
      let reencodeCount = 0;
      let allSegmentsHaveAudio = true; // Track if all segments have audio for proper concat
      
      // Process video segments in parallel batches based on parallelSegments setting
      const batchSize = Math.max(1, parallelSegments || 1);
      logExport('info', 'Processing segments in parallel batches', {
        totalSegments: VE.state.timeline.length,
        batchSize,
        parallelSegments
      });
      
      for (let batchStart = 0; batchStart < VE.state.timeline.length; batchStart += batchSize) {
        const batchEnd = Math.min(batchStart + batchSize, VE.state.timeline.length);
        const batch = VE.state.timeline.slice(batchStart, batchEnd);
        
        // Calculate progress: 18% to 55% range (37% total for video segments)
        const batchProgress = 18 + ((batchStart / totalClips) * 37);
        updateProgressWithEta(batchProgress, batchStart + 1, totalClips);
        
        // Process batch in parallel
        const batchPromises = batch.map(async (segment, batchIndex) => {
          const i = batchStart + batchIndex;
          const clipNum = i + 1;
          
          try {
            const segmentResult = await processSegmentForExport(
              segment, i, ffmpeg, projW, projH, 
              { preset, crf, audioBitrate, fps }
            );
            
            if (segmentResult) {
              const { filename: segmentFilename, hasAudio } = segmentResult;
              
              if (!hasAudio) {
                allSegmentsHaveAudio = false;
                logExport('warn', 'Segment has no audio - will affect audio continuity', { index: i, clipNum });
              }
              
              // Track whether this segment was stream-copied or re-encoded
              const asset = VE.state.assets.find(a => a.id === segment.assetId);
              const wasReencoded = segment.type === 'text' || 
                                   (asset && asset.type === 'image') || 
                                   (segment.crop && segment.crop.width > 0) ||
                                   (segment.transform && (segment.transform.x !== 0 || segment.transform.y !== 0 || segment.transform.scale !== 100)) ||
                                   hasActiveFilters();
              
              logExport('info', 'Video segment created', {
                index: i,
                clipNum,
                filename: segmentFilename,
                hasAudio,
                method: wasReencoded ? 're-encode' : 'stream-copy'
              });
              
              return { 
                index: i, 
                result: segmentResult, 
                wasReencoded 
              };
            } else {
              logExport('warn', 'Video segment returned null - skipping', {
                index: i,
                clipNum
              });
              return { index: i, result: null, wasReencoded: false };
            }
          } catch (err) {
            logExport('error', 'Error processing video segment', {
              index: i,
              clipNum,
              error: err
            });
            // Continue with other segments
            return { index: i, result: null, wasReencoded: false, error: err };
          }
        });
        
        // Wait for all segments in batch to complete
        const batchResults = await Promise.allSettled(batchPromises);
        
        // Process batch results in order
        batchResults.forEach((result, batchIndex) => {
          if (result.status === 'fulfilled' && result.value && result.value.result) {
            const { index, result: segmentResult, wasReencoded } = result.value;
            // Store in sparse array - we'll fill in order later
            segmentFiles[index] = segmentResult.filename;
            segmentResults[index] = segmentResult;
            allCreatedFiles.push(segmentResult.filename);
            
            if (wasReencoded) {
              reencodeCount++;
            } else {
              streamCopyCount++;
            }
          }
        });
        
        // Update progress after batch completes
        const completedProgress = 18 + ((batchEnd / totalClips) * 37);
        safeUpdateProgress(completedProgress, `Encoded clip ${batchEnd}/${totalClips}`);
        exportProgressState.currentSegment = batchEnd;
      }
      
      // Convert sparse arrays to dense arrays in correct order
      const orderedSegmentFiles = [];
      const orderedSegmentResults = [];
      for (let i = 0; i < VE.state.timeline.length; i++) {
        if (segmentFiles[i] && segmentResults[i]) {
          orderedSegmentFiles.push(segmentFiles[i]);
          orderedSegmentResults.push(segmentResults[i]);
        }
      }
      
      // Check if we have any video segments to concat
      if (orderedSegmentFiles.length === 0) {
        throw new Error('No video segments were created successfully');
      }

      logExport('info', 'All video segments processed', {
        segmentCount: orderedSegmentFiles.length,
        streamCopyCount,
        reencodeCount,
        allSegmentsHaveAudio,
        note: streamCopyCount > 0 
          ? `${streamCopyCount} segment(s) preserved original quality via stream copy` 
          : 'All segments required re-encoding due to transformations/filters'
      });
      
      // Inform user if re-encoding occurred (which increases file size)
      if (reencodeCount > 0 && streamCopyCount === 0) {
        logExport('info', 'Note: All segments were re-encoded. File may be larger than original if transforms/filters were applied.');
      }
      
      if (!allSegmentsHaveAudio) {
        logExport('warn', 'WARNING: Some segments have no audio. This may cause audio sync issues in the final export.');
      }
      
      // Phase 2b: Process audio tracks (55-75%)
      safeUpdateProgress(55, 'Processing audio tracks...');
      const audioFiles = [];
      
      // Collect all audio sources:
      // 1. Audio from video segments (where audio is NOT detached)
      // 2. Detached audio timeline
      // 3. Custom audio timeline
      
      const hasDetachedAudio = VE.state.detachedAudioTimeline.length > 0;
      const hasCustomAudio = VE.state.customAudioTimeline.length > 0;
      
      // Log all timeline segments to understand their types
      logExport('info', 'Timeline segments summary', {
        totalSegments: VE.state.timeline.length,
        segments: VE.state.timeline.map((s, i) => ({
          index: i,
          id: s.id,
          type: s.type,
          assetId: s.assetId,
          audioDetached: s.audioDetached,
          startOffset: s.startOffset,
          endOffset: s.endOffset
        }))
      });
      
      // Note: Video segment audio is now embedded directly in the video segments during processSegmentForExport
      // We only need to process ADDITIONAL audio tracks here (detached and custom audio)
      const videoSegmentsWithEmbeddedAudio = VE.state.timeline.filter(s => 
        (s.type === 'video' || (VE.state.assets.find(a => a.id === s.assetId)?.type === 'video')) && 
        !s.audioDetached
      ).length;
      
      logExport('info', 'Audio configuration', {
        videoSegmentsWithEmbeddedAudio,
        hasDetachedAudio,
        hasCustomAudio,
        detachedAudioCount: VE.state.detachedAudioTimeline.length,
        customAudioCount: VE.state.customAudioTimeline.length,
        note: 'Video audio is embedded in segments, only processing additional audio tracks'
      });
      
      // Log detached audio timeline if present
      if (hasDetachedAudio) {
        logExport('info', 'Detached audio timeline to process', {
          segments: VE.state.detachedAudioTimeline.map((s, i) => ({
            index: i,
            id: s.id,
            assetId: s.assetId,
            timelineStart: s.timelineStart,
            startOffset: s.startOffset,
            endOffset: s.endOffset
          }))
        });
      }
      
      // Note: When audio is "detached" from a video segment:
      // 1. The video segment has audioDetached=true, so it exports with SILENT audio
      // 2. The detached audio exists in detachedAudioTimeline for UI/timeline editing purposes
      // 3. If the user deletes the detached audio, the export will have no audio for that segment
      // The detached audio timeline is currently NOT separately processed for FFmpeg export
      // (it's only used for MediaRecorder fallback export and UI playback)
      if (hasDetachedAudio) {
        logExport('info', 'Detached audio detected - video segments with detached audio will be silent', {
          detachedAudioCount: VE.state.detachedAudioTimeline.length,
          note: 'Video segments with audioDetached=true export with silent audio'
        });
      }
      
      // Process custom audio timeline
      if (hasCustomAudio) {
        safeUpdateProgress(68, 'Processing custom audio...');
        for (let i = 0; i < VE.state.customAudioTimeline.length; i++) {
          const segment = VE.state.customAudioTimeline[i];
          
          try {
            const audioResult = await processAudioSegmentForExport(
              segment, 2000 + i, ffmpeg, audioBitrate, totalDuration
            );
            
            if (audioResult) {
              audioFiles.push(audioResult);
              allCreatedFiles.push(audioResult.filename);
              logExport('info', 'Custom audio processed', {
                index: i,
                filename: audioResult.filename
              });
            }
          } catch (err) {
            logExport('warn', 'Failed to process custom audio segment', {
              index: i,
              error: err
            });
          }
        }
      }
      
      logExport('info', 'Additional audio segments processed (detached/custom)', {
        audioSegmentCount: audioFiles.length,
        audioFiles: audioFiles.map(af => ({ filename: af.filename, timelineStart: af.timelineStart, duration: af.duration }))
      });
      safeUpdateProgress(75, 'Audio processed');

      /**
       * Build an FFmpeg filter_complex string that mixes:
       * - The main audio track from input 0 (when includeMainInput === true)
       * - Additional audio tracks from inputs 1..N stored in audioFiles
       * Each additional track is time-aligned using its timelineStart (seconds)
       * via adelay, so multiple music clips on the custom audio timeline play
       * in sequence at the correct positions instead of all starting at 0.
       */
      function buildAudioMixFilter(audioFiles, includeMainInput) {
        const filterChains = [];
        const mixInputs = [];

        // Optional main audio (embedded in the concatenated video)
        if (includeMainInput) {
          mixInputs.push('[0:a]');
        }

        // Additional audio inputs start at index 1 (corresponding to -i arguments)
        audioFiles.forEach((af, i) => {
          const inputIndex = i + 1; // 1-based because input 0 is video (and possibly audio)
          const inputLabel = `[${inputIndex}:a]`;
          const delayMs = Math.max(0, Math.round((af.timelineStart || 0) * 1000));

          if (delayMs > 0) {
            // Apply per-track delay so clips appear at the right time on the timeline
            const delayedLabel = `[ad${inputIndex}]`;
            filterChains.push(`${inputLabel}adelay=${delayMs}|${delayMs}${delayedLabel}`);
            mixInputs.push(delayedLabel);
          } else {
            mixInputs.push(inputLabel);
          }
        });

        const totalInputs = mixInputs.length;
        const amixPart = `${mixInputs.join('')}amix=inputs=${totalInputs}:duration=longest:dropout_transition=2[aout]`;

        // If we had delays, chain them before amix; otherwise just amix
        return filterChains.length > 0
          ? `${filterChains.join(';')};${amixPart}`
          : amixPart;
      }

      // Phase 3: Concat video segments (with embedded audio) and mix additional audio (75-92%)
      setExportPhase('concat');
      safeUpdateProgress(76, 'Merging video segments...');
      
      // Check audio compatibility before concatenation
      const audioCompatibility = checkAudioCompatibility(orderedSegmentResults);
      logExport('info', 'Audio compatibility analysis for concatenation', {
        compatible: audioCompatibility.compatible,
        reason: audioCompatibility.reason,
        recommendedMethod: audioCompatibility.recommendedConcatMethod,
        sampleRates: Array.from(audioCompatibility.sampleRates),
        channelCounts: Array.from(audioCompatibility.channelCounts),
        codecs: Array.from(audioCompatibility.codecs)
      });
      
      // Build concat list from successfully created video segments
      const concatList = orderedSegmentFiles.map(f => `file '${f}'`).join('\n');
      logExport('info', 'Concat list created', { segmentFiles: orderedSegmentFiles, concatList });
      await ffmpeg.writeFile('concat.txt', new TextEncoder().encode(concatList));
      allCreatedFiles.push('concat.txt');
      
      const outputFilename = `output.${format}`;
      
      // With our new approach, ALL segments should have audio (either real or silent)
      // This ensures proper audio continuity during concatenation
      logExport('info', 'Audio configuration for concat', {
        allSegmentsHaveAudio,
        additionalAudioTracks: audioFiles.length,
        audioFilenames: audioFiles.map(af => af.filename),
        audioCompatible: audioCompatibility.compatible
      });

      // Primary concat strategy: All segments have embedded audio (real or silent)
      if (allSegmentsHaveAudio) {
        if (audioFiles.length === 0) {
          // Simple case: Just concat segments with their embedded audio
          // Use audio compatibility to determine if we can use stream copy
          const useStreamCopyAudio = audioCompatibility.compatible && audioCompatibility.recommendedConcatMethod === 'stream-copy';
          logExport('info', 'Concatenating segments with embedded audio (no additional tracks)', {
            useStreamCopyAudio,
            concatStrategy: useStreamCopyAudio ? 'stream-copy (fastest)' : 'audio re-encode (for consistency)'
          });
        
          let concatSuccess = false;
          
          // Method 0: Try full stream copy first if audio is compatible (FASTEST)
          if (useStreamCopyAudio) {
            try {
              const streamCopyArgs = [
                '-f', 'concat', '-safe', '0', '-i', 'concat.txt',
                '-c:v', 'copy',
                '-c:a', 'copy',
                '-movflags', '+faststart',
                '-y',
                outputFilename
              ];
              logExport('info', 'Concat args (full stream copy - fastest)', { args: streamCopyArgs.join(' ') });
              await ffmpeg.exec(streamCopyArgs);
              
              const outData = await ffmpeg.readFile(outputFilename);
              if (outData && outData.byteLength > 1000) {
                logExport('info', 'Concat successful (full stream copy)', { outputSize: outData.byteLength });
                concatSuccess = true;
              }
            } catch (streamCopyErr) {
              logExport('warn', 'Full stream copy concat failed, trying audio re-encode', { error: streamCopyErr.message || String(streamCopyErr) });
            }
          }
          
          // Method 1: Re-encode audio to ensure consistent parameters across all clips
          // This fixes the issue where only the first clip's audio is included
          // The concat demuxer with -c copy can fail when audio streams have different parameters
          if (!concatSuccess) {
            try {
              const concatArgs = [
                '-f', 'concat', '-safe', '0', '-i', 'concat.txt',
                '-c:v', 'copy',
                '-c:a', 'aac', '-b:a', audioBitrate, '-ar', '44100', '-ac', '2',
                '-movflags', '+faststart',
                '-y',
                outputFilename
              ];
              logExport('info', 'Concat args (video copy, audio re-encode for consistency)', { args: concatArgs.join(' ') });
              await ffmpeg.exec(concatArgs);
              
              const outData = await ffmpeg.readFile(outputFilename);
              if (outData && outData.byteLength > 1000) {
                logExport('info', 'Concat successful (video copy, audio re-encoded)', { outputSize: outData.byteLength });
                concatSuccess = true;
              }
            } catch (concatErr) {
              logExport('warn', 'Video copy concat failed', { error: concatErr.message || String(concatErr) });
            }
          }
          
          // Method 2: Full re-encode if video copy failed
          if (!concatSuccess) {
            try {
              safeUpdateProgress(78, 'Re-encoding video...');
          const reencodeArgs = [
            '-f', 'concat', '-safe', '0', '-i', 'concat.txt',
            '-c:v', 'libx264', '-preset', preset, '-crf', crf.toString(),
            '-c:a', 'aac', '-b:a', audioBitrate, '-ar', '44100', '-ac', '2',
            '-movflags', '+faststart',
                '-y',
            outputFilename
          ];
          logExport('info', 'Concat args (full re-encode)', { args: reencodeArgs.join(' ') });
          await ffmpeg.exec(reencodeArgs);
              
              const outData = await ffmpeg.readFile(outputFilename);
              if (outData && outData.byteLength > 1000) {
                logExport('info', 'Concat successful (full re-encode)', { outputSize: outData.byteLength });
                concatSuccess = true;
              }
            } catch (reencodeErr) {
              logExport('error', 'Full re-encode concat also failed', { error: reencodeErr.message || String(reencodeErr) });
              throw new Error('Failed to concatenate video segments');
            }
          }
          
        safeUpdateProgress(90, 'Video merged');
        
        } else {
          // We have additional audio tracks to mix in
          logExport('info', 'Concatenating segments, then mixing with additional audio tracks', {
            additionalAudioCount: audioFiles.length
          });
          
          // First, concat the video segments (with their embedded audio)
          // Re-encode audio to ensure consistent parameters across all clips
          const concatFilename = 'concat_temp.mp4';
          
          let concatSuccess = false;
          try {
            const concatArgs = [
              '-f', 'concat', '-safe', '0', '-i', 'concat.txt',
              '-c:v', 'copy',
              '-c:a', 'aac', '-b:a', audioBitrate, '-ar', '44100', '-ac', '2',
              '-y',
              concatFilename
            ];
            logExport('info', 'Concat args (video copy, audio re-encode)', { args: concatArgs.join(' ') });
            await ffmpeg.exec(concatArgs);
            concatSuccess = true;
            logExport('info', 'Concat successful (audio re-encoded for consistency)');
          } catch (concatErr) {
            logExport('warn', 'Video copy concat failed, trying with full re-encode', { error: concatErr.message || String(concatErr) });
            try {
              const reencodeArgs = [
                '-f', 'concat', '-safe', '0', '-i', 'concat.txt',
                '-c:v', 'libx264', '-preset', preset, '-crf', crf.toString(),
                '-c:a', 'aac', '-b:a', audioBitrate, '-ar', '44100', '-ac', '2',
                '-y',
                concatFilename
              ];
              await ffmpeg.exec(reencodeArgs);
              concatSuccess = true;
              logExport('info', 'Concat successful (full re-encode)');
            } catch (reencodeErr) {
              logExport('error', 'Full re-encode concat failed', { error: reencodeErr.message || String(reencodeErr) });
            }
          }
          
          if (!concatSuccess) {
            throw new Error('Failed to concatenate video segments');
          }
          
          allCreatedFiles.push(concatFilename);
          safeUpdateProgress(82, 'Mixing audio tracks...');
          
          // Now mix in the additional audio tracks with the video's embedded audio
          const mixArgs = ['-i', concatFilename];
          audioFiles.forEach(af => {
            mixArgs.push('-i', af.filename);
          });
          
          // Build filter_complex to mix video's audio with additional tracks
          // IMPORTANT: Respect each custom audio segment's timelineStart so that
          // multiple clips on the music layer are placed correctly in time.
          const filterComplex = buildAudioMixFilter(audioFiles, true);
          
          mixArgs.push(
            '-filter_complex', filterComplex,
            '-map', '0:v:0',
            '-map', '[aout]',
            '-c:v', 'copy',
            '-c:a', 'aac', '-b:a', audioBitrate,
            '-movflags', '+faststart',
            '-y',
            outputFilename
          );
          
          logExport('info', 'Audio mix args', { args: mixArgs.join(' ') });
          
          let mixSuccess = false;
          try {
            await ffmpeg.exec(mixArgs);
            const outData = await ffmpeg.readFile(outputFilename);
            if (outData && outData.byteLength > 1000) {
              logExport('info', 'Audio mixing successful', { outputSize: outData.byteLength });
              mixSuccess = true;
            }
          } catch (mixErr) {
            logExport('warn', 'Audio mixing failed, trying video copy only', { error: mixErr.message || String(mixErr) });
          }
          
          // Fallback: Just use the concatenated video without additional audio
          if (!mixSuccess) {
            logExport('warn', 'Using concatenated video without additional audio mixing');
            try {
              await ffmpeg.exec([
                '-i', concatFilename,
                '-c', 'copy',
                '-movflags', '+faststart',
                '-y',
                outputFilename
              ]);
              logExport('info', 'Fallback: copied concat video directly');
            } catch (copyErr) {
              logExport('error', 'Fallback copy also failed', { error: copyErr.message || String(copyErr) });
              throw new Error('Failed to create output file');
            }
          }
          
          safeUpdateProgress(90, 'Audio mixed');
        }
      } else {
        // Fallback: Some segments don't have audio (shouldn't happen with new code, but handle it)
        logExport('warn', 'Not all segments have audio - using legacy concat logic');
        
        // First try to concat with audio re-encoding (fixes multi-clip audio issues)
        const concatWithAudioFile = 'concat_with_audio_temp.mp4';
        let concatWithAudioSuccess = false;
        
        try {
          await ffmpeg.exec([
            '-f', 'concat', '-safe', '0', '-i', 'concat.txt',
            '-c:v', 'copy',
            '-c:a', 'aac', '-b:a', audioBitrate, '-ar', '44100', '-ac', '2',
            '-y',
            concatWithAudioFile
          ]);
          const outData = await ffmpeg.readFile(concatWithAudioFile);
          if (outData && outData.byteLength > 1000) {
            concatWithAudioSuccess = true;
            logExport('info', 'Legacy concat with audio re-encode successful');
          }
        } catch (e) {
          logExport('warn', 'Legacy concat with audio failed, trying video-only', { error: e.message || String(e) });
        }
        
        if (concatWithAudioSuccess) {
          allCreatedFiles.push(concatWithAudioFile);
          
          if (audioFiles.length === 0) {
            // No additional audio - just copy the concatenated file
            await ffmpeg.exec([
              '-i', concatWithAudioFile,
              '-c', 'copy',
              '-movflags', '+faststart',
              '-y',
              outputFilename
            ]);
          } else {
            // Mix additional audio tracks with the concatenated video+audio
            safeUpdateProgress(82, 'Mixing audio tracks...');
            
            const mixArgs = ['-i', concatWithAudioFile];
            audioFiles.forEach(af => mixArgs.push('-i', af.filename));
            
            // Mix concatenated video+audio (input 0) with additional tracks,
            // again honoring each segment's timelineStart.
            const filterComplex = buildAudioMixFilter(audioFiles, true);
            
            mixArgs.push(
              '-filter_complex', filterComplex,
              '-map', '0:v:0',
              '-map', '[aout]',
              '-c:v', 'copy',
              '-c:a', 'aac', '-b:a', audioBitrate, '-ar', '44100', '-ac', '2',
              '-movflags', '+faststart',
              '-y',
              outputFilename
            );
            
            try {
              await ffmpeg.exec(mixArgs);
              logExport('info', 'Audio mixing with concat successful');
            } catch (mixErr) {
              logExport('warn', 'Audio mixing failed, using concat only', { error: mixErr.message || String(mixErr) });
              await ffmpeg.exec([
                '-i', concatWithAudioFile,
                '-c', 'copy',
                '-movflags', '+faststart',
                '-y',
                outputFilename
              ]);
            }
          }
        } else {
          // True fallback: concat video only, then add audio
          const videoOnlyFile = 'video_only_temp.mp4';
          try {
            await ffmpeg.exec([
              '-f', 'concat', '-safe', '0', '-i', 'concat.txt',
              '-c:v', 'copy',
              '-an',
              '-y',
              videoOnlyFile
            ]);
          } catch (e) {
            await ffmpeg.exec([
              '-f', 'concat', '-safe', '0', '-i', 'concat.txt',
              '-c:v', 'libx264', '-preset', preset, '-crf', crf.toString(),
              '-an',
              '-y',
              videoOnlyFile
            ]);
          }
          allCreatedFiles.push(videoOnlyFile);
          
          safeUpdateProgress(80, 'Processing audio...');
          
          if (audioFiles.length === 0) {
            // No additional audio - add silent track for compatibility
            logExport('info', 'Adding silent audio track for compatibility');
            await ffmpeg.exec([
              '-i', videoOnlyFile,
              '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
              '-c:v', 'copy',
              '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
              '-map', '0:v:0',
              '-map', '1:a:0',
              '-shortest',
              '-movflags', '+faststart',
              '-y',
              outputFilename
            ]);
          } else if (audioFiles.length === 1) {
            // Single audio track
            logExport('info', 'Adding single audio track to video-only concat');
            
            let audioAddSuccess = false;
            
            // Try method 1: standard approach
            try {
              await ffmpeg.exec([
                '-i', videoOnlyFile,
                '-i', audioFiles[0].filename,
                '-map', '0:v:0',
                '-map', '1:a:0',
                '-c:v', 'copy',
                '-c:a', 'aac', '-b:a', audioBitrate, '-ar', '44100', '-ac', '2',
                '-shortest',
                '-movflags', '+faststart',
                '-y',
                outputFilename
              ]);
              const outData = await ffmpeg.readFile(outputFilename);
              if (outData && outData.byteLength > 1000) {
                audioAddSuccess = true;
              }
            } catch (e) {
              logExport('warn', 'Standard audio add failed', { error: e.message || String(e) });
            }
            
            // Fallback: full re-encode
            if (!audioAddSuccess) {
              try {
                await ffmpeg.exec([
                  '-i', videoOnlyFile,
                  '-i', audioFiles[0].filename,
                  '-map', '0:v:0',
                  '-map', '1:a:0',
                  '-c:v', 'libx264', '-preset', preset, '-crf', crf.toString(),
                  '-c:a', 'aac', '-b:a', audioBitrate, '-ar', '44100', '-ac', '2',
                  '-shortest',
                  '-movflags', '+faststart',
                  '-y',
                  outputFilename
                ]);
                audioAddSuccess = true;
              } catch (e) {
                logExport('warn', 'Re-encode audio add failed', { error: e.message || String(e) });
              }
            }
            
            // Last resort: video only
            if (!audioAddSuccess) {
              logExport('error', 'All audio methods failed, using video only');
              await ffmpeg.exec([
                '-i', videoOnlyFile,
                '-c', 'copy',
                '-movflags', '+faststart',
                '-y',
                outputFilename
              ]);
            }
          } else {
            // Multiple audio tracks - mix them
            logExport('info', 'Mixing multiple audio tracks with video-only concat');
            
            const mixArgs = ['-i', videoOnlyFile];
            audioFiles.forEach(af => mixArgs.push('-i', af.filename));
            
            // Only additional audio tracks are mixed here (no embedded audio),
            // but we still need to respect their timelineStart offsets.
            const filterComplex = buildAudioMixFilter(audioFiles, false);
            
            mixArgs.push(
              '-filter_complex', filterComplex,
              '-map', '0:v:0',
              '-map', '[aout]',
              '-c:v', 'copy',
              '-c:a', 'aac', '-b:a', audioBitrate, '-ar', '44100', '-ac', '2',
              '-shortest',
              '-movflags', '+faststart',
              '-y',
              outputFilename
            );
            
            try {
              await ffmpeg.exec(mixArgs);
              logExport('info', 'Audio mixing successful');
            } catch (mixErr) {
              logExport('warn', 'Audio mixing failed, using first track only', { error: mixErr.message || String(mixErr) });
              await ffmpeg.exec([
                '-i', videoOnlyFile,
                '-i', audioFiles[0].filename,
                '-map', '0:v:0',
                '-map', '1:a:0',
                '-c:v', 'copy',
                '-c:a', 'aac', '-b:a', audioBitrate, '-ar', '44100', '-ac', '2',
                '-shortest',
                '-movflags', '+faststart',
                '-y',
                outputFilename
              ]);
            }
          }
        }
        
        safeUpdateProgress(90, 'Video merged');
      }
      
      allCreatedFiles.push(outputFilename);
      safeUpdateProgress(92, 'Export complete');
      
      // Phase 4: Finalize (92-100%)
      setExportPhase('finalize');
      safeUpdateProgress(94, 'Reading output file...');

      const data = await ffmpeg.readFile(outputFilename);
      
      safeUpdateProgress(96, 'Preparing download...');
      
      const blob = new Blob([data.buffer], { type: `video/${format}` });
      
      // Cleanup files and prefetch cache (best effort, don't block)
      setTimeout(async () => {
        try {
          VE.state.prefetchedAssets.clear();
          for (const file of allCreatedFiles) {
            await ffmpeg.deleteFile(file).catch(() => {});
          }
        } catch (e) { /* ignore cleanup errors */ }
      }, 100);
      
      // Calculate export time
      const exportTime = Math.round((Date.now() - VE.state.exportStartTime) / 1000);
      const exportTimeStr = formatElapsedTime(exportTime);
      
      safeUpdateProgress(100, `Export complete! (${exportTimeStr})`);
      
      // Wait a moment so user sees 100% and completed phases
      await new Promise(r => setTimeout(r, 500));
      
      // Show export complete modal with options instead of direct download
      const exportMetadata = {
        duration: VE.state.totalDuration,
        width: VE.state.exportResolution.width,
        height: VE.state.exportResolution.height,
        format: format,
        exportTime: exportTimeStr
      };
      showExportCompleteModal(blob, `video-export.${format}`, exportMetadata);
      
      logExport('info', 'Export finished successfully - showing completion modal', {
        exportTimeSeconds: exportTime,
        exportFormat: format,
        outputFilename
      });

    } catch (error) {
      logExport('error', 'Export error', error);
      const raw = (error && error.message) ? String(error.message) : 'Export could not finish.';
      const friendly = raw.length > 160 ? raw.slice(0, 160) + '…' : raw;
      VE.showToast('error', 'Export failed', friendly);
      
      // Cleanup on error
      setTimeout(async () => {
        try {
          VE.state.prefetchedAssets.clear();
          const ffmpeg = VE.state.ffmpeg;
          if (ffmpeg) {
            for (const file of allCreatedFiles) {
              await ffmpeg.deleteFile(file).catch(() => {});
            }
          }
        } catch (e) { /* ignore cleanup errors */ }
      }, 100);
    } finally {
      logExport('info', 'Export routine finished (success or error), resetting FFmpeg export UI state');
      exportProgressState.isExporting = false;
      exportProgressState.phase = 'idle';
      VE.elements.startExportBtn.disabled = false;
      VE.elements.progressText.textContent = 'Ready to export';
      setProgressBar(0);
      exportProgressState.lastProgressValue = 0;
      resetPhaseIndicators();
      VE.state.exportStartTime = 0;
      VE.state.prefetchedAssets.clear();
    }
  }

  async function exportWithMediaRecorder() {
    logExport('info', 'Starting MediaRecorder fallback export');
    VE.showToast('info', 'Fallback Export', 'Using browser recording...');
    VE.elements.startExportBtn.disabled = true;
    
    // Ensure export start time is set (in case it wasn't set in startExport)
    if (!VE.state.exportStartTime || VE.state.exportStartTime === 0) {
      VE.state.exportStartTime = Date.now();
    }
    
    // Reset progress state
    exportProgressState.lastProgressValue = 0;
    exportProgressState.isExporting = true;
    setProgressBar(0);
    setExportPhase('loading');
    safeUpdateProgress(5, 'Preparing export...');
    
    // Audio context and nodes for mixing
    let audioContext = null;
    let audioDestination = null;
    const audioSources = [];
    
    try {
      // Create an offscreen canvas for rendering
      const exportWidth = VE.state.exportResolution.width;
      const exportHeight = VE.state.exportResolution.height;
      const canvas = document.createElement('canvas');
      canvas.width = exportWidth;
      canvas.height = exportHeight;
      const ctx = canvas.getContext('2d');
      
      // Calculate total duration (consider audio tracks)
      VE.updateTotalDuration();
      VE.updateAudioDuration();
      const videoDuration = VE.state.totalDuration;
      const audioDuration = VE.state.audioDuration;
      const totalDuration = Math.max(videoDuration, audioDuration);
      
      if (totalDuration === 0) {
        logExport('warn', 'MediaRecorder export aborted: totalDuration is 0', {
          videoDuration,
          audioDuration
        });
        VE.showToast('error', 'Export Failed', 'No content to export');
        return;
      }
      
      // Set up audio context for mixing audio tracks
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      audioDestination = audioContext.createMediaStreamDestination();
      
      // Get video stream from canvas
      let videoStream;
      try {
        videoStream = canvas.captureStream(30);
      } catch (e) {
        logExport('error', 'Canvas captureStream not supported', e);
        VE.showToast('error', 'Export Failed', 'Canvas capture not supported');
        return;
      }
      
      // Prepare audio sources for all audio tracks
      safeUpdateProgress(8, 'Preparing audio...');
      
      // Helper to create an audio source for a segment
      const prepareAudioSource = async (segment, isMuted) => {
        if (isMuted) return null;
        
        const asset = VE.state.assets.find(a => a.id === segment.assetId);
        if (!asset || !asset.objectUrl) return null;
        
        const audio = document.createElement('audio');
        audio.src = asset.objectUrl;
        audio.preload = 'auto';
        audio.muted = true; // Mute the element, we'll capture via Web Audio
        
        await new Promise((resolve, reject) => {
          audio.oncanplaythrough = resolve;
          audio.onerror = reject;
          setTimeout(resolve, 3000); // Timeout fallback
        });
        
        const source = audioContext.createMediaElementSource(audio);
        const gainNode = audioContext.createGain();
        gainNode.gain.value = segment.volume || 1.0;
        
        source.connect(gainNode);
        gainNode.connect(audioDestination);
        
        return {
          audio,
          segment,
          timelineStart: segment.timelineStart || 0,
          startOffset: segment.startOffset || 0,
          endOffset: segment.endOffset || asset.duration,
          playing: false
        };
      };
      
      // Prepare video segment audio (where not detached)
      // For MediaRecorder fallback, we need to handle audio from video segments
      let videoTimelinePosition = 0;
      for (const segment of VE.state.timeline) {
        // Only process video segments that have audio AND audio is not detached
        if (segment.type !== 'text' && !segment.audioDetached) {
          const asset = VE.state.assets.find(a => a.id === segment.assetId);
          if (asset && asset.type === 'video' && asset.objectUrl) {
            try {
            const audioInfo = await prepareAudioSource({
              ...segment,
                timelineStart: videoTimelinePosition,
                volume: segment.volume || 1.0
            }, false);
              if (audioInfo) {
                audioSources.push(audioInfo);
                logExport('info', 'Prepared video audio for MediaRecorder', { 
                  segmentId: segment.id, 
                  timelinePosition: videoTimelinePosition 
                });
              }
            } catch (err) {
              logExport('warn', 'Failed to prepare video audio source', { 
                segmentId: segment.id, 
                error: err.message || String(err) 
              });
            }
          }
        }
        videoTimelinePosition += (segment.endOffset - segment.startOffset);
      }
      
      // Prepare detached audio
      for (const segment of VE.state.detachedAudioTimeline) {
        try {
          const audioInfo = await prepareAudioSource(segment, VE.state.isDetachedAudioMuted);
          if (audioInfo) {
            audioSources.push(audioInfo);
            logExport('info', 'Prepared detached audio for MediaRecorder', { segmentId: segment.id });
          }
        } catch (err) {
          logExport('warn', 'Failed to prepare detached audio source', { 
            segmentId: segment.id, 
            error: err.message || String(err) 
          });
        }
      }
      
      // Prepare custom audio
      for (const segment of VE.state.customAudioTimeline) {
        try {
          const audioInfo = await prepareAudioSource(segment, VE.state.isCustomAudioMuted);
          if (audioInfo) {
            audioSources.push(audioInfo);
            logExport('info', 'Prepared custom audio for MediaRecorder', { segmentId: segment.id });
          }
        } catch (err) {
          logExport('warn', 'Failed to prepare custom audio source', { 
            segmentId: segment.id, 
            error: err.message || String(err) 
          });
        }
      }
      
      logExport('info', 'Prepared audio sources for MediaRecorder export', {
        audioSourceCount: audioSources.length
      });
      
      // Combine video and audio streams
      const combinedStream = new MediaStream([
        ...videoStream.getVideoTracks(),
        ...audioDestination.stream.getAudioTracks()
      ]);
      
      // Set up MediaRecorder with combined stream
      const format = VE.elements.exportFormat.value;
      const mimeType = format === 'webm' ? 'video/webm;codecs=vp9,opus' : 'video/mp4';
      const fallbackMime = 'video/webm;codecs=vp9,opus';
      
      let mediaRecorder;
      try {
        const options = MediaRecorder.isTypeSupported(mimeType) 
          ? { mimeType, videoBitsPerSecond: 8000000, audioBitsPerSecond: 128000 } 
          : { mimeType: fallbackMime, videoBitsPerSecond: 8000000, audioBitsPerSecond: 128000 };
        mediaRecorder = new MediaRecorder(combinedStream, options);
      } catch (e) {
        logExport('error', 'Failed to start MediaRecorder', e);
        VE.showToast('error', 'Export Failed', 'MediaRecorder not supported');
        return;
      }
      
      const chunks = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      
      // Promise for recording completion
      const recordingComplete = new Promise((resolve, reject) => {
        mediaRecorder.onstop = () => resolve(chunks);
        mediaRecorder.onerror = (e) => reject(e.error);
      });
      
      // Resume audio context (required for autoplay policy)
      await audioContext.resume();
      
      // Start recording
      mediaRecorder.start(100);
      logExport('info', 'MediaRecorder started');
      setExportPhase('segments');
      safeUpdateProgress(10, 'Recording frames...');
      
      // Render each segment frame by frame
      const fps = 30;
      const frameTime = 1000 / fps;
      let currentTime = 0;
      let segmentIndex = 0;
      let segmentStartTime = 0;
      
      // Function to update audio playback based on current time
      const updateAudioPlayback = (time) => {
        audioSources.forEach(src => {
          const segmentEnd = src.timelineStart + (src.endOffset - src.startOffset);
          
          if (time >= src.timelineStart && time < segmentEnd) {
            // Should be playing
            if (!src.playing) {
              const timeIntoSegment = time - src.timelineStart;
              src.audio.currentTime = src.startOffset + timeIntoSegment;
              src.audio.play().catch(() => {});
              src.playing = true;
            }
          } else {
            // Should not be playing
            if (src.playing) {
              src.audio.pause();
              src.playing = false;
            }
          }
        });
      };
      
      const renderFrame = () => {
        return new Promise((resolve) => {
          // Check if we've passed the video duration
          if (segmentIndex >= VE.state.timeline.length) {
            // If audio is still going, just render black
            if (currentTime < totalDuration) {
              ctx.fillStyle = '#000';
              ctx.fillRect(0, 0, exportWidth, exportHeight);
              resolve(false);
              return;
            }
            resolve(true);
            return;
          }
          
          const segment = VE.state.timeline[segmentIndex];
          const segmentDuration = segment.endOffset - segment.startOffset;
          const timeInSegment = currentTime - segmentStartTime;
          
          if (timeInSegment >= segmentDuration) {
            segmentStartTime = currentTime;
            segmentIndex++;
            resolve(false);
            return;
          }
          
          // Clear canvas
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, exportWidth, exportHeight);
          
          if (segment.type === 'text') {
            // Render text frame
            ctx.fillStyle = segment.bgColor || '#000';
            ctx.fillRect(0, 0, exportWidth, exportHeight);
            
            ctx.fillStyle = segment.color || '#fff';
            const fontSize = Math.round((segment.fontSize || 48) * (exportWidth / 1920));
            ctx.font = `bold ${fontSize}px ${segment.font || 'DM Sans'}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            
            const lines = (segment.text || '').split('\n');
            const lineHeight = fontSize * 1.4;
            const startY = exportHeight / 2 - ((lines.length - 1) * lineHeight) / 2;
            
            lines.forEach((line, idx) => {
              ctx.fillText(line, exportWidth / 2, startY + idx * lineHeight);
            });
          } else {
            // Render video frame
            const asset = VE.state.assets.find(a => a.id === segment.assetId);
            if (asset) {
              // Get or create video element for rendering
              const video = asset.element || VE.elements.previewVideo;
              
              if (video.src !== asset.objectUrl) {
                video.src = asset.objectUrl;
              }
              
              video.currentTime = segment.startOffset + timeInSegment;
              
              // Wait for video to seek
              const seekPromise = new Promise(seekResolve => {
                const onSeeked = () => {
                  video.removeEventListener('seeked', onSeeked);
                  seekResolve();
                };
                video.addEventListener('seeked', onSeeked);
                setTimeout(seekResolve, 100);
              });
              
              seekPromise.then(() => {
                const transform = segment.transform || { x: 0, y: 0, scale: 100 };
                const crop = segment.crop;
                
                let srcX = 0, srcY = 0, srcW = video.videoWidth || exportWidth, srcH = video.videoHeight || exportHeight;
                if (crop && crop.width > 0 && crop.height > 0) {
                  srcX = crop.x;
                  srcY = crop.y;
                  srcW = crop.width;
                  srcH = crop.height;
                }
                
                const aspectRatio = srcW / srcH;
                const scale = transform.scale / 100;
                let destW, destH;
                
                if (aspectRatio > exportWidth / exportHeight) {
                  destW = exportWidth * scale;
                  destH = destW / aspectRatio;
                } else {
                  destH = exportHeight * scale;
                  destW = destH * aspectRatio;
                }
                
                const destX = (exportWidth - destW) / 2 + transform.x * (exportWidth / VE.state.projectResolution.width);
                const destY = (exportHeight - destH) / 2 + transform.y * (exportHeight / VE.state.projectResolution.height);
                
                ctx.drawImage(video, srcX, srcY, srcW, srcH, destX, destY, destW, destH);
                resolve(false);
              });
              return;
            }
          }
          
          resolve(false);
        });
      };
      
      // Main render loop
      const totalFrames = Math.ceil(totalDuration * fps);
      let frameCount = 0;
      
      const processFrames = async () => {
        while (frameCount < totalFrames && currentTime < totalDuration) {
          // Update audio playback state
          updateAudioPlayback(currentTime);
          
          const done = await renderFrame();
          if (done) break;
          
          currentTime += frameTime / 1000;
          frameCount++;
          
          // Update progress (10% to 90% range for rendering)
          const progress = 10 + Math.min(80, (frameCount / totalFrames) * 80);
          safeUpdateProgress(progress, `Rendering: ${Math.round(progress)}%`);
          
          // Yield to UI
          await new Promise(r => setTimeout(r, frameTime / 2));
        }
        
        // Stop all audio sources
        audioSources.forEach(src => {
          src.audio.pause();
          src.playing = false;
        });
        
        // Stop recording
        mediaRecorder.stop();
        setExportPhase('concat');
        safeUpdateProgress(92, 'Finalizing...');
        
        // Wait for recording to complete
        const finalChunks = await recordingComplete;
        
        setExportPhase('finalize');
        safeUpdateProgress(96, 'Preparing download...');
        
        // Create blob and show export complete modal
        const blob = new Blob(finalChunks, { type: mediaRecorder.mimeType });
        const ext = mediaRecorder.mimeType.includes('webm') ? 'webm' : 'mp4';
        
        // Calculate export time
        const exportTime = Math.round((Date.now() - VE.state.exportStartTime) / 1000);
        const exportTimeStr = formatElapsedTime(exportTime);
        
        safeUpdateProgress(100, `Export complete! (${exportTimeStr})`);
        await new Promise(r => setTimeout(r, 500));
        
        // Show export complete modal with options instead of direct download
        const exportMetadata = {
          duration: totalDuration,
          width: VE.state.exportResolution.width,
          height: VE.state.exportResolution.height,
          format: ext,
          exportTime: exportTimeStr
        };
        showExportCompleteModal(blob, `video-export.${ext}`, exportMetadata);
        
        logExport('info', 'MediaRecorder export finished successfully - showing completion modal', {
          totalDuration,
          exportFormat: ext
        });
      };
      
      await processFrames();
      
    } catch (error) {
      logExport('error', 'MediaRecorder export error', error);
      const rawMr = (error && error.message) ? String(error.message) : 'Export could not finish.';
      const friendlyMr = rawMr.length > 160 ? rawMr.slice(0, 160) + '…' : rawMr;
      VE.showToast('error', 'Export failed', friendlyMr);
    } finally {
      // Cleanup audio context
      if (audioContext && audioContext.state !== 'closed') {
        audioSources.forEach(src => {
          try { src.audio.pause(); } catch(e) {}
        });
        try { await audioContext.close(); } catch(e) {}
      }
      
      logExport('info', 'MediaRecorder export routine finished (success or error), resetting UI state');
      exportProgressState.isExporting = false;
      exportProgressState.phase = 'idle';
      VE.elements.startExportBtn.disabled = false;
      VE.elements.progressText.textContent = 'Ready to export';
      setProgressBar(0);
      resetPhaseIndicators();
      exportProgressState.lastProgressValue = 0;
    }
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ============================================
  // Export Complete Actions Modal
  // ============================================
  
  // Store the exported blob for later actions
  let pendingExportBlob = null;
  let pendingExportFilename = null;
  let pendingExportMetadata = null;

  /**
   * Show the export complete modal with options to download and/or save to system
   */
  function showExportCompleteModal(blob, filename, metadata = {}) {
    pendingExportBlob = blob;
    pendingExportFilename = filename;
    pendingExportMetadata = metadata;
    
    const modal = document.getElementById('export-complete-modal');
    if (modal) {
      const downloadCheckbox = document.getElementById('export-action-download');
      if (downloadCheckbox) downloadCheckbox.checked = true;
      
      // Update file info display
      const fileSizeDisplay = document.getElementById('export-file-size');
      const durationDisplay = document.getElementById('export-duration');
      const resolutionDisplay = document.getElementById('export-resolution-display');
      const processingTimeDisplay = document.getElementById('export-processing-time');
      
      if (fileSizeDisplay) {
        const sizeMB = (blob.size / (1024 * 1024)).toFixed(2);
        fileSizeDisplay.textContent = `${sizeMB} MB`;
      }
      if (durationDisplay && metadata.duration) {
        const mins = Math.floor(metadata.duration / 60);
        const secs = Math.floor(metadata.duration % 60);
        durationDisplay.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
      }
      if (resolutionDisplay && metadata.width && metadata.height) {
        resolutionDisplay.textContent = `${metadata.width} × ${metadata.height}`;
      }
      if (processingTimeDisplay) {
        // Get elapsed time from metadata or calculate it
        let processingTimeStr = '--';
        if (metadata.exportTime) {
          processingTimeStr = metadata.exportTime;
        } else if (VE.state.exportStartTime && VE.state.exportStartTime > 0) {
          const exportTime = Math.round((Date.now() - VE.state.exportStartTime) / 1000);
          processingTimeStr = formatElapsedTime(exportTime);
        }
        processingTimeDisplay.textContent = processingTimeStr;
      }
      
      modal.classList.add('show');
    }
  }

  VE.closeExportCompleteModal = function() {
    const modal = document.getElementById('export-complete-modal');
    if (modal) {
      modal.classList.remove('show');
    }
    // Clean up the pending blob
    if (pendingExportBlob) {
      pendingExportBlob = null;
      pendingExportFilename = null;
      pendingExportMetadata = null;
    }
  };

  VE.executeExportActions = async function() {
    const downloadCheckbox = document.getElementById('export-action-download');
    const confirmBtn = document.getElementById('confirm-export-actions');

    const shouldDownload = downloadCheckbox?.checked;

    if (!shouldDownload) {
      VE.showToast('warning', 'No Action Selected', 'Enable download to save the file');
      return;
    }

    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
    }

    try {
      if (shouldDownload && pendingExportBlob) {
        downloadBlob(pendingExportBlob, pendingExportFilename);
      }

      VE.closeExportCompleteModal();
      VE.closeExportModal();

      VE.showToast('success', 'Success!', 'Video downloaded successfully');
    } catch (error) {
      console.error('Error executing export actions:', error);
      VE.showToast('error', 'Error', error.message || 'Failed to complete export actions');
    } finally {
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = '<i class="fas fa-check"></i> Confirm';
      }
    }
  };

  // Setup export complete modal event listeners
  VE.setupExportCompleteModal = function() {
    const modal = document.getElementById('export-complete-modal');
    const closeBtn = document.getElementById('close-export-complete-modal');
    const cancelBtn = document.getElementById('cancel-export-actions');
    const confirmBtn = document.getElementById('confirm-export-actions');

    if (closeBtn) {
      closeBtn.addEventListener('click', VE.closeExportCompleteModal);
    }
    if (cancelBtn) {
      cancelBtn.addEventListener('click', VE.closeExportCompleteModal);
    }
    if (confirmBtn) {
      confirmBtn.addEventListener('click', VE.executeExportActions);
    }
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) VE.closeExportCompleteModal();
      });
    }
  };

  // Initialize modal on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', VE.setupExportCompleteModal);
  } else {
    // Give time for DOM to be ready
    setTimeout(VE.setupExportCompleteModal, 100);
  }

  // Export the show function for use in export completion
  VE.showExportCompleteModal = showExportCompleteModal;

})();

