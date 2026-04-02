/**
 * Video Lab Editor - Playback Module
 * Video preview, timeline playback, crop preview rendering
 */

(function() {
  'use strict';
  
  const VE = window.VideoEditor = window.VideoEditor || {};

  // ============================================
  // Crop preview rendering state
  // ============================================
  let cropPreviewAnimationId = null;

  // ============================================
  // Video Preview Functions
  // ============================================
  VE.loadVideoToPreview = function(asset, segment = null) {
    VE.state.currentAsset = asset;
    VE.state.currentPreviewSegment = segment;
    
    const video = VE.elements.previewVideo;
    
    // IMPORTANT:
    // We intentionally do NOT set crossOrigin="anonymous" here.
    // Assets coming from GCS work fine for playback without CORS,
    // but forcing crossOrigin triggers CORS checks that can fail
    // when the bucket CORS config is not under our control.
    video.removeAttribute('crossOrigin');
    
    video.src = asset.objectUrl;
    video.classList.add('active');
    VE.elements.canvasPlaceholder.style.display = 'none';
    VE.elements.textFrameCanvas.classList.remove('active');
    VE.elements.imageFrameCanvas.classList.remove('active');
    
    // Error handler for video loading issues
    video.onerror = (e) => {
      console.error('Video load error:', e, video.error);
      VE.showToast('error', 'Video Load Failed', 'Could not load video');
    };
    
    // Ensure video displays first frame after loading
    video.onloadeddata = () => {
      video.onloadeddata = null;
      video.onerror = null;
      // Seek to a small offset to ensure first frame is rendered
      if (video.currentTime === 0) {
        video.currentTime = 0.001;
      }
      // Render to composition canvas after video is ready (for aspect ratio preview)
      if (VE.state.timeline.length > 0) {
        VE.renderComposition();
      }
    };
    
    video.load();
    
    // Apply crop preview if segment has crop data
    if (segment && segment.crop) {
      VE.startCropPreviewRendering(segment);
    } else {
      VE.stopCropPreviewRendering();
    }
  };

  VE.startCropPreviewRendering = function(segment) {
    VE.stopCropPreviewRendering();
    
    if (!segment || !segment.crop) return;
    
    const asset = VE.state.assets.find(a => a.id === segment.assetId);
    if (!asset) return;
    
    // Show canvas instead of video
    VE.elements.videoCanvas.classList.add('crop-preview-active');
    VE.elements.previewVideo.classList.add('hidden-for-crop');
    
    const canvas = VE.elements.videoCanvas.querySelector('canvas.crop-render-canvas') || createCropRenderCanvas();
    const ctx = canvas.getContext('2d');
    
    const renderCropFrame = () => {
      if (!VE.state.currentPreviewSegment || !VE.state.currentPreviewSegment.crop) {
        VE.stopCropPreviewRendering();
        return;
      }
      
      const crop = VE.state.currentPreviewSegment.crop;
      const video = VE.elements.previewVideo;
      
      if (video.readyState >= 2) {
        // Set canvas size to match cropped dimensions (scaled to fit)
        const cropAspect = crop.width / crop.height;
        const containerRect = VE.elements.videoCanvas.getBoundingClientRect();
        const containerAspect = containerRect.width / containerRect.height;
        
        let canvasWidth, canvasHeight;
        if (cropAspect > containerAspect) {
          canvasWidth = containerRect.width;
          canvasHeight = containerRect.width / cropAspect;
        } else {
          canvasHeight = containerRect.height;
          canvasWidth = containerRect.height * cropAspect;
        }
        
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;
        canvas.style.width = canvasWidth + 'px';
        canvas.style.height = canvasHeight + 'px';
        
        // Draw cropped region
        ctx.drawImage(
          video,
          crop.x, crop.y, crop.width, crop.height,
          0, 0, canvasWidth, canvasHeight
        );
      }
      
      cropPreviewAnimationId = requestAnimationFrame(renderCropFrame);
    };
    
    renderCropFrame();
  };

  VE.stopCropPreviewRendering = function() {
    if (cropPreviewAnimationId) {
      cancelAnimationFrame(cropPreviewAnimationId);
      cropPreviewAnimationId = null;
    }
    
    VE.elements.videoCanvas.classList.remove('crop-preview-active');
    VE.elements.previewVideo.classList.remove('hidden-for-crop');
    
    // Hide crop render canvas
    const canvas = VE.elements.videoCanvas.querySelector('canvas.crop-render-canvas');
    if (canvas) {
      canvas.style.display = 'none';
    }
  };

  function createCropRenderCanvas() {
    const canvas = document.createElement('canvas');
    canvas.className = 'crop-render-canvas';
    canvas.style.position = 'absolute';
    canvas.style.top = '50%';
    canvas.style.left = '50%';
    canvas.style.transform = 'translate(-50%, -50%)';
    canvas.style.maxWidth = '100%';
    canvas.style.maxHeight = '100%';
    VE.elements.videoCanvas.appendChild(canvas);
    return canvas;
  }

  VE.updateTimeDisplay = function() {
    if (VE.elements.timeDisplay) {
      VE.elements.timeDisplay.textContent = VE.formatTime(VE.state.currentTime);
    }
  };

  VE.togglePlay = function() {
    if (VE.state.timeline.length > 0) {
      VE.toggleTimelinePlayback();
      return;
    }
    
  };

  // ============================================
  // Timeline Playback
  // ============================================
  VE.toggleTimelinePlayback = function() {
    if (VE.state.timeline.length === 0) {
      VE.showToast('info', 'Timeline Empty', 'Add clips to the timeline first');
      return;
    }

    if (VE.state.isPlaying && VE.state.timelinePlaybackMode) {
      VE.stopTimelinePlayback();
    } else {
      // Start from current playhead position
      VE.startTimelinePlaybackFromTime(VE.state.currentTime);
    }
  };

  VE.startTimelinePlaybackFromTime = function(startTime) {
    // Find which segment and position to start from
    const { segmentIndex, segmentTime } = VE.getSegmentAtTime(startTime);
    
    if (segmentIndex === -1) {
      // Playhead is past all segments, start from beginning
      startTimelinePlayback(0, 0);
      return;
    }
    
    startTimelinePlayback(segmentIndex, segmentTime);
  };

  VE.getSegmentAtTime = function(time) {
    let accumulatedTime = 0;
    
    for (let i = 0; i < VE.state.timeline.length; i++) {
      const seg = VE.state.timeline[i];
      const segDuration = seg.endOffset - seg.startOffset;
      
      if (time < accumulatedTime + segDuration) {
        // Found the segment
        const timeIntoSegment = time - accumulatedTime;
        return { segmentIndex: i, segmentTime: timeIntoSegment };
      }
      
      accumulatedTime += segDuration;
    }
    
    return { segmentIndex: -1, segmentTime: 0 };
  };

  function startTimelinePlayback(fromIndex = 0, startTimeInSegment = 0) {
    VE.state.timelinePlaybackMode = true;
    VE.state.currentTimelineIndex = fromIndex;
    VE.state.isPlaying = true;
    VE.state.playbackStartTimeInSegment = startTimeInSegment;
    
    VE.elements.playBtn.innerHTML = '<i class="fas fa-pause"></i>';
    
    // Start composition rendering for timeline playback
    VE.startCompositionRendering();
    
    // Start audio track playback
    VE.startAudioTrackPlayback(VE.state.currentTime);
    
    playTimelineSegment(fromIndex, startTimeInSegment);
  }

  VE.stopTimelinePlayback = function() {
    VE.state.timelinePlaybackMode = false;
    VE.state.isPlaying = false;
    
    VE.elements.previewVideo.pause();
    VE.elements.playBtn.innerHTML = '<i class="fas fa-play"></i>';
    
    // Stop all audio elements
    VE.stopAudioTrackPlayback();
    
    VE.hideTextFramePreview();
    VE.hideImageFramePreview();
    
    // Stop composition rendering loop but render one last frame
    VE.stopCompositionRendering();
    VE.renderComposition();
    
    const segments = VE.elements.timelineTracks.querySelectorAll('.timeline-segment');
    segments.forEach(seg => seg.classList.remove('playing'));
  };

  function playTimelineSegment(index, startTimeInSegment = 0) {
    if (index >= VE.state.timeline.length) {
      VE.stopTimelinePlayback();
      VE.state.currentTime = 0;
      VE.setPlayheadPosition(0);
      VE.state.currentTimelineIndex = 0;
      return;
    }

    const segment = VE.state.timeline[index];
    
    if (segment.type === 'text') {
      VE.stopCropPreviewRendering();
      playTextFrameSegment(segment, index, startTimeInSegment);
      return;
    }
    
    if (segment.type === 'image') {
      VE.stopCropPreviewRendering();
      playImageFrameSegment(segment, index, startTimeInSegment);
      return;
    }
    
    const asset = VE.state.assets.find(a => a.id === segment.assetId);
    if (!asset) {
      playTimelineSegment(index + 1, 0);
      return;
    }

    VE.hideTextFramePreview();
    VE.hideImageFramePreview();
    
    const video = VE.elements.previewVideo;
    
    // See note in VE.loadVideoToPreview – do not force crossOrigin here.
    video.removeAttribute('crossOrigin');
    
    // Check if we need to change source
    const needsSourceChange = video.src !== asset.objectUrl;
    
    if (needsSourceChange) {
      video.src = asset.objectUrl;
      video.load(); // Ensure video starts loading
    }
    
    video.classList.add('active');
    VE.elements.canvasPlaceholder.style.display = 'none';
    
    // Store current segment for crop preview
    VE.state.currentPreviewSegment = segment;
    
    // Apply crop preview if segment has crop data
    if (segment.crop) {
      VE.startCropPreviewRendering(segment);
    } else {
      VE.stopCropPreviewRendering();
    }
    
    const startPlayback = () => {
      // Calculate the actual video time to seek to
      const videoStartTime = segment.startOffset + startTimeInSegment;
      video.currentTime = videoStartTime;
      
      // Mute video if audio was detached
      video.muted = segment.audioDetached === true;
      
      video.play().catch(err => {
        console.warn('Video playback failed:', err);
        // Try to recover by pausing and re-playing
        video.pause();
        setTimeout(() => {
          video.play().catch(() => {});
        }, 100);
      });
      VE.highlightTimelineSegment(index);
      
      // Clear any previous listener
      video.removeEventListener('timeupdate', video._onTimeUpdate);
      
      const onTimeUpdate = () => {
        if (!VE.state.timelinePlaybackMode) {
          video.removeEventListener('timeupdate', onTimeUpdate);
          return;
        }
        
        updatePlayheadPositionFromVideo();
        
        if (video.currentTime >= segment.endOffset - 0.05) {
          video.removeEventListener('timeupdate', onTimeUpdate);
          VE.state.currentTimelineIndex = index + 1;
          playTimelineSegment(index + 1, 0);
        }
      };
      
      video._onTimeUpdate = onTimeUpdate;
      video.addEventListener('timeupdate', onTimeUpdate);
    };
    
    if (needsSourceChange) {
      // Use oncanplay to ensure video has enough data to start rendering
      video.oncanplay = () => {
        video.oncanplay = null;
        startPlayback();
      };
    } else {
      startPlayback();
    }
  }

  function playTextFrameSegment(segment, index, startTimeInSegment = 0) {
    VE.elements.previewVideo.pause();
    VE.elements.previewVideo.classList.remove('active');
    
    VE.showTextFrameInPreview(segment);
    VE.highlightTimelineSegment(index);
    
    const totalDuration = (segment.endOffset - segment.startOffset) * 1000;
    const remainingDuration = totalDuration - (startTimeInSegment * 1000);
    VE.state.textFrameStartTime = performance.now() - (startTimeInSegment * 1000);
    
    const updateTextFrame = () => {
      if (!VE.state.timelinePlaybackMode) return;
      
      const elapsed = performance.now() - VE.state.textFrameStartTime;
      updatePlayheadPositionFromTextFrame(index, elapsed / 1000);
      
      if (elapsed >= totalDuration) {
        VE.state.currentTimelineIndex = index + 1;
        playTimelineSegment(index + 1, 0);
      } else {
        requestAnimationFrame(updateTextFrame);
      }
    };
    
    requestAnimationFrame(updateTextFrame);
  }

  function playImageFrameSegment(segment, index, startTimeInSegment = 0) {
    VE.elements.previewVideo.pause();
    VE.elements.previewVideo.classList.remove('active');
    
    VE.showImageFrameInPreview(segment);
    VE.highlightTimelineSegment(index);
    
    const totalDuration = (segment.endOffset - segment.startOffset) * 1000;
    const remainingDuration = totalDuration - (startTimeInSegment * 1000);
    VE.state.imageFrameStartTime = performance.now() - (startTimeInSegment * 1000);
    
    const updateImageFrame = () => {
      if (!VE.state.timelinePlaybackMode) return;
      
      const elapsed = performance.now() - VE.state.imageFrameStartTime;
      updatePlayheadPositionFromImageFrame(index, elapsed / 1000);
      
      if (elapsed >= totalDuration) {
        VE.state.currentTimelineIndex = index + 1;
        playTimelineSegment(index + 1, 0);
      } else {
        requestAnimationFrame(updateImageFrame);
      }
    };
    
    requestAnimationFrame(updateImageFrame);
  }

  function updatePlayheadPositionFromVideo() {
    if (VE.state.timeline.length === 0) return;
    
    let totalOffset = 0;
    
    // Add duration of all previous segments
    for (let i = 0; i < VE.state.currentTimelineIndex; i++) {
      const seg = VE.state.timeline[i];
      totalOffset += (seg.endOffset - seg.startOffset);
    }
    
    // Add current position within current segment
    const currentSeg = VE.state.timeline[VE.state.currentTimelineIndex];
    if (currentSeg && currentSeg.type !== 'text') {
      const videoTime = VE.elements.previewVideo.currentTime;
      const timeInSegment = Math.max(0, videoTime - currentSeg.startOffset);
      totalOffset += Math.min(timeInSegment, currentSeg.endOffset - currentSeg.startOffset);
    }
    
    VE.state.currentTime = totalOffset;
    VE.updateTimeDisplay();
    VE.setPlayheadPosition(totalOffset);
  }

  function updatePlayheadPositionFromTextFrame(index, elapsedInSegment) {
    let totalOffset = 0;
    
    // Add duration of all previous segments
    for (let i = 0; i < index; i++) {
      const seg = VE.state.timeline[i];
      totalOffset += (seg.endOffset - seg.startOffset);
    }
    
    // Add elapsed time in current text segment
    const currentSeg = VE.state.timeline[index];
    if (currentSeg) {
      totalOffset += Math.min(elapsedInSegment, currentSeg.endOffset - currentSeg.startOffset);
    }
    
    VE.state.currentTime = totalOffset;
    VE.updateTimeDisplay();
    VE.setPlayheadPosition(totalOffset);
  }

  function updatePlayheadPositionFromImageFrame(index, elapsedInSegment) {
    let totalOffset = 0;
    
    // Add duration of all previous segments
    for (let i = 0; i < index; i++) {
      const seg = VE.state.timeline[i];
      totalOffset += (seg.endOffset - seg.startOffset);
    }
    
    // Add elapsed time in current image segment
    const currentSeg = VE.state.timeline[index];
    if (currentSeg) {
      totalOffset += Math.min(elapsedInSegment, currentSeg.endOffset - currentSeg.startOffset);
    }
    
    VE.state.currentTime = totalOffset;
    VE.updateTimeDisplay();
    VE.setPlayheadPosition(totalOffset);
  }

  // ============================================
  // Seek Timeline
  // ============================================
  VE.seekTimeline = function(time) {
    // Consider audio duration in total seekable range
    const maxDuration = Math.max(VE.state.totalDuration, VE.state.audioDuration);
    VE.state.currentTime = Math.max(0, Math.min(time, maxDuration));
    VE.setPlayheadPosition(VE.state.currentTime);
    VE.updateTimeDisplay();
    
    // Update audio track on seek
    VE.updateAudioOnSeek(VE.state.currentTime);
    
    // Update the video preview to show the frame at this time
    const { segmentIndex, segmentTime } = VE.getSegmentAtTime(VE.state.currentTime);
    
    if (segmentIndex !== -1) {
      const segment = VE.state.timeline[segmentIndex];
      VE.state.currentTimelineIndex = segmentIndex;
      VE.state.currentPreviewSegment = segment;
      
      if (segment.type === 'text') {
        VE.stopCropPreviewRendering();
        VE.showTextFrameInPreview(segment);
        VE.elements.previewVideo.classList.remove('active');
        // Render text to composition canvas
        VE.renderComposition();
      } else if (segment.type === 'image') {
        VE.stopCropPreviewRendering();
        VE.showImageFrameInPreview(segment);
        VE.elements.previewVideo.classList.remove('active');
        // Render image to composition canvas - will be handled by renderComposition
        // But we need to trigger it after image loads
        setTimeout(() => VE.renderComposition(), 100);
      } else {
        const asset = VE.state.assets.find(a => a.id === segment.assetId);
        if (asset) {
          VE.hideTextFramePreview();
    VE.hideImageFramePreview();
          const video = VE.elements.previewVideo;
          
          // See note in VE.loadVideoToPreview – do not force crossOrigin here.
          video.removeAttribute('crossOrigin');
          
          // Mute video if audio was detached
          video.muted = segment.audioDetached === true;
          
          // Use video pool to pre-warm adjacent videos for faster seeking
          preWarmAdjacentVideos(segmentIndex);
          
          if (video.src !== asset.objectUrl) {
            video.src = asset.objectUrl;
            video.load(); // Ensure video starts loading
            video.oncanplay = () => {
              video.oncanplay = null;
              video.currentTime = segment.startOffset + segmentTime;
              // Apply crop preview after video is loaded
              if (segment.crop) {
                VE.startCropPreviewRendering(segment);
              } else {
                VE.stopCropPreviewRendering();
              }
              // Render to composition canvas after video is ready
              video.onseeked = () => VE.renderComposition();
            };
          } else {
            video.currentTime = segment.startOffset + segmentTime;
            // Apply crop preview
            if (segment.crop) {
              VE.startCropPreviewRendering(segment);
            } else {
              VE.stopCropPreviewRendering();
            }
            // Render to composition canvas after seek completes
            video.onseeked = () => VE.renderComposition();
          }
          
          video.classList.add('active');
          VE.elements.canvasPlaceholder.style.display = 'none';
        }
      }
      
      VE.highlightTimelineSegment(segmentIndex);
    } else {
      // Not on any segment, stop crop preview
      VE.stopCropPreviewRendering();
      VE.renderComposition();
    }
  };

  /**
   * Pre-warm videos in the pool for adjacent timeline segments
   * This makes switching between clips much faster
   */
  function preWarmAdjacentVideos(currentIndex) {
    // Pre-warm next and previous segment videos
    const indicesToWarm = [currentIndex - 1, currentIndex + 1, currentIndex + 2];
    
    indicesToWarm.forEach(index => {
      if (index >= 0 && index < VE.state.timeline.length) {
        const segment = VE.state.timeline[index];
        if (segment && segment.assetId && segment.type !== 'text') {
          const asset = VE.state.assets.find(a => a.id === segment.assetId);
          if (asset && asset.type === 'video') {
            // This will load the video into the pool if not already there
            VE.videoPool.get(asset);
          }
        }
      }
    });
  }

  // ============================================
  // Playback Speed
  // ============================================
  VE.setPlaybackSpeed = function(speed) {
    VE.state.playbackSpeed = speed;
    
    // Update the video playback rate
    VE.elements.previewVideo.playbackRate = speed;
    
    // Update all audio elements' playback rate
    VE.state.audioElements.forEach(audio => {
      audio.playbackRate = speed;
    });
    
    // Update UI
    if (VE.elements.speedLabel) {
      VE.elements.speedLabel.textContent = speed + 'x';
    }
    
    // Update active state in dropdown
    if (VE.elements.speedDropdown) {
      VE.elements.speedDropdown.querySelectorAll('.speed-option').forEach(option => {
        option.classList.toggle('active', parseFloat(option.dataset.speed) === speed);
      });
    }
    
    VE.showToast('info', 'Speed Changed', `Playback speed: ${speed}x`);
  };

  // ============================================
  // Audio Track Playback
  // ============================================
  VE.startAudioTrackPlayback = function(startTime) {
    // Process both audio timelines
    const allAudioSegments = [
      ...VE.state.detachedAudioTimeline.map(s => ({ ...s, trackType: 'detached' })),
      ...VE.state.customAudioTimeline.map(s => ({ ...s, trackType: 'custom' }))
    ];
    
    if (allAudioSegments.length === 0) return;
    
    // Find and play all audio segments that overlap with current time
    allAudioSegments.forEach(segment => {
      const segmentStart = segment.timelineStart;
      const segmentEnd = segmentStart + (segment.endOffset - segment.startOffset);
      
      // Check if this segment should be playing at startTime
      if (startTime >= segmentStart && startTime < segmentEnd) {
        VE.playAudioSegment(segment, startTime);
      } else if (startTime < segmentStart) {
        // Schedule this segment to play when the playhead reaches it
        VE.scheduleAudioSegment(segment, startTime);
      }
    });
  };

  VE.playAudioSegment = function(segment, currentTime) {
    const asset = VE.state.assets.find(a => a.id === segment.assetId);
    if (!asset) return;
    
    // Check if this track is muted
    const isMuted = segment.trackType === 'detached' 
      ? VE.state.isDetachedAudioMuted 
      : VE.state.isCustomAudioMuted;
    
    // Create or get audio element
    let audio = VE.state.audioElements.get(segment.id);
    if (!audio) {
      audio = document.createElement('audio');
      audio.preload = 'auto';
      audio.src = asset.objectUrl;
      VE.state.audioElements.set(segment.id, audio);
    }
    
    // Calculate where to start in the audio
    const segmentStart = segment.timelineStart;
    const timeIntoSegment = currentTime - segmentStart;
    const audioTime = segment.startOffset + timeIntoSegment;
    
    audio.currentTime = audioTime;
    audio.playbackRate = VE.state.playbackSpeed;
    audio.muted = isMuted;
    audio.volume = segment.volume || 1.0;
    
    // Add timeupdate listener to stop at segment end
    audio.ontimeupdate = () => {
      if (!VE.state.timelinePlaybackMode) {
        audio.pause();
        return;
      }
      if (audio.currentTime >= segment.endOffset - 0.05) {
        audio.pause();
        audio.ontimeupdate = null;
      }
    };
    
    audio.play().catch(err => {
      // AbortError is expected when pause() is called while play() is pending
      // This happens during normal playback control (pause, seek, etc.)
      if (err.name === 'AbortError') {
        // Silently ignore - this is expected behavior
        return;
      }
      // Only log actual unexpected errors
      console.warn('Audio playback failed:', err);
    });
  };

  VE.scheduleAudioSegment = function(segment, currentPlayTime) {
    const delay = (segment.timelineStart - currentPlayTime) * 1000 / VE.state.playbackSpeed;
    
    const timeoutId = setTimeout(() => {
      if (VE.state.timelinePlaybackMode && VE.state.isPlaying) {
        VE.playAudioSegment(segment, segment.timelineStart);
      }
    }, delay);
    
    // Store timeout ID for cleanup - find original segment in timeline
    const timeline = segment.trackType === 'detached' 
      ? VE.state.detachedAudioTimeline 
      : VE.state.customAudioTimeline;
    const originalSeg = timeline.find(s => s.id === segment.id);
    if (originalSeg) {
      originalSeg._scheduleTimeout = timeoutId;
    }
  };

  VE.stopAudioTrackPlayback = function() {
    // Stop all audio elements and clear timeouts from both timelines
    [...VE.state.detachedAudioTimeline, ...VE.state.customAudioTimeline].forEach(segment => {
      if (segment._scheduleTimeout) {
        clearTimeout(segment._scheduleTimeout);
        delete segment._scheduleTimeout;
      }
    });
    
    VE.state.audioElements.forEach(audio => {
      audio.pause();
      audio.ontimeupdate = null;
    });
  };

  VE.seekAudioTrack = function(time) {
    // Stop all current audio playback
    VE.stopAudioTrackPlayback();
    
    // If not playing, don't restart audio
    if (!VE.state.isPlaying) return;
    
    // Restart audio from new position
    VE.startAudioTrackPlayback(time);
  };

  // ============================================
  // Update Audio During Seek
  // ============================================
  VE.updateAudioOnSeek = function(time) {
    // This is called when seeking to update audio state for both timelines
    [...VE.state.detachedAudioTimeline, ...VE.state.customAudioTimeline].forEach(segment => {
      const segmentStart = segment.timelineStart;
      const segmentEnd = segmentStart + (segment.endOffset - segment.startOffset);
      
      const audio = VE.state.audioElements.get(segment.id);
      if (audio) {
        if (time >= segmentStart && time < segmentEnd) {
          // Segment is at this time, update position
          const timeIntoSegment = time - segmentStart;
          const audioTime = segment.startOffset + timeIntoSegment;
          audio.currentTime = audioTime;
        } else {
          // Segment is not at this time, pause it
          audio.pause();
        }
      }
    });
  };

})();

