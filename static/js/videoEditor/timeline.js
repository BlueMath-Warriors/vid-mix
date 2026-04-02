/**
 * Video Lab Editor - Timeline Module
 * Timeline rendering, segment management, drag/drop, trimming
 */

(function() {
  'use strict';
  
  const VE = window.VideoEditor = window.VideoEditor || {};

  // ============================================
  // Drag state for clip reordering
  // ============================================
  let dragState = {
    draggingIndex: -1,
    dropTargetIndex: -1,
    isDragging: false
  };

  // ============================================
  // Timeline Functions
  // ============================================
  VE.addToTimeline = function(asset) {
    const segment = {
      id: VE.generateId(),
      assetId: asset.id,
      name: asset.name,
      type: asset.type,
      duration: asset.duration,
      startOffset: 0,
      endOffset: asset.duration,
      originalDuration: asset.duration,
      colorIndex: VE.state.timeline.length % VE.clipColors.length,
      thumbnail: asset.thumbnail
    };

    VE.state.timeline.push(segment);
    VE.updateTotalDuration();
    VE.renderTimeline();
    VE.showToast('success', 'Added to Timeline', asset.name);
    // Auto-save progress
    if (typeof VE.scheduleProgressSave === 'function') {
      VE.scheduleProgressSave();
    }
  };

  VE.updateTotalDuration = function() {
    VE.state.totalDuration = VE.state.timeline.reduce((sum, s) => sum + (s.endOffset - s.startOffset), 0);
  };

  VE.renderTimeline = function() {
    const elements = VE.elements;
    
    // Clear tracks but keep playhead
    const playhead = elements.playhead;
    elements.timelineTracks.innerHTML = '';
    elements.timelineTracks.appendChild(playhead);
    
    // Create video track area
    let videoTrackArea = document.createElement('div');
    videoTrackArea.className = 'video-track-area';
    
    VE.updateTotalDuration();
    
    // Render video segments and calculate actual visual width
    // Add spacing between segments (4px gap on each side)
    const SEGMENT_SPACING = 4;
    let xOffset = SEGMENT_SPACING; // Start with left spacing
    VE.state.timeline.forEach((segment, index) => {
      const segmentEl = VE.createSegmentElement(segment, index, xOffset);
      videoTrackArea.appendChild(segmentEl);
      const durationWidth = (segment.endOffset - segment.startOffset) * VE.state.zoomLevel;
      const visualWidth = Math.max(VE.MIN_SEGMENT_WIDTH, durationWidth);
      xOffset += visualWidth + SEGMENT_SPACING; // Add spacing after each segment
    });
    
    // Video end position is the accumulated xOffset
    const videoEndPosition = xOffset;
    
    // Check audio tracks for end positions
    let audioEndPosition = 0;
    [...VE.state.detachedAudioTimeline, ...VE.state.customAudioTimeline].forEach(segment => {
      const segmentStart = segment.timelineStart || 0;
      const segmentDuration = segment.endOffset - segment.startOffset;
      const segmentEnd = segmentStart + segmentDuration;
      const pixelEnd = segmentEnd * VE.state.zoomLevel;
      audioEndPosition = Math.max(audioEndPosition, pixelEnd);
    });
    
    // Get the viewport width from the scroll container
    const scrollContainer = elements.timelineTracks.closest('.timeline-content-column');
    const viewportWidth = scrollContainer ? scrollContainer.clientWidth : 1000;
    
    // Timeline width should be the maximum of:
    // 1. Actual video content width (with minimum widths applied)
    // 2. Audio content width
    // 3. Viewport width (so timeline always fills the view)
    const contentEnd = Math.max(videoEndPosition, audioEndPosition);
    const timelineWidth = Math.max(viewportWidth, contentEnd + 50);
    
    // Set width for video track area
    videoTrackArea.style.setProperty('width', `${timelineWidth}px`, 'important');
    videoTrackArea.style.setProperty('min-width', `${timelineWidth}px`, 'important');
    videoTrackArea.style.setProperty('max-width', `${timelineWidth}px`, 'important');
    
    // Set width on timeline tracks container
    elements.timelineTracks.style.setProperty('width', `${timelineWidth}px`, 'important');
    elements.timelineTracks.style.setProperty('min-width', `${timelineWidth}px`, 'important');
    elements.timelineTracks.style.setProperty('max-width', `${timelineWidth}px`, 'important');
    
    // Set width on timeline-tracks-container (parent of timeline-tracks)
    const timelineTracksContainer = elements.timelineTracks.closest('.timeline-tracks-container');
    if (timelineTracksContainer) {
      timelineTracksContainer.style.setProperty('width', `${timelineWidth}px`, 'important');
      timelineTracksContainer.style.setProperty('min-width', `${timelineWidth}px`, 'important');
      timelineTracksContainer.style.setProperty('max-width', `${timelineWidth}px`, 'important');
    }
    
    elements.timelineTracks.appendChild(videoTrackArea);
    
    // Ensure width is maintained after appending
    requestAnimationFrame(() => {
      videoTrackArea.style.setProperty('width', `${timelineWidth}px`, 'important');
      elements.timelineTracks.style.setProperty('width', `${timelineWidth}px`, 'important');
      if (timelineTracksContainer) {
        timelineTracksContainer.style.setProperty('width', `${timelineWidth}px`, 'important');
      }
    });
  
    // Render ruler with matching width
    VE.renderTimelineRuler(timelineWidth);
  
    // Render audio tracks with matching width
    VE.renderAudioTrack(timelineWidth);
  };


  
  // ============================================
  // Audio Track Rendering
  // ============================================
  VE.renderAudioTrack = function(timelineWidth) {
    const elements = VE.elements;
    const labelsColumn = document.getElementById('track-labels-column');
    
    // Calculate timeline width if not provided
    if (!timelineWidth) {
      const maxDuration = Math.max(VE.state.totalDuration, VE.state.audioDuration || 0);
      timelineWidth = Math.max(1000, maxDuration * VE.state.zoomLevel + 20); // Small padding only
    }
    
    // Clear existing audio track labels (keep video label and spacer)
    if (labelsColumn) {
      const existingAudioLabels = labelsColumn.querySelectorAll('.audio-track-label');
      existingAudioLabels.forEach(el => el.remove());
    }
    
    // Render Detached Audio Track
    renderSingleAudioTrack(
      'detached-audio-track',
      'Detached',
      'fa-unlink',
      VE.state.detachedAudioTimeline,
      VE.state.isDetachedAudioMuted,
      'detached',
      labelsColumn,
      timelineWidth
    );
    
    // Render Custom Audio Track
    renderSingleAudioTrack(
      'custom-audio-track',
      'Audio',
      'fa-music',
      VE.state.customAudioTimeline,
      VE.state.isCustomAudioMuted,
      'custom',
      labelsColumn,
      timelineWidth
    );
  };

  function renderSingleAudioTrack(className, label, icon, timeline, isMuted, trackType, labelsColumn, timelineWidth) {
    const elements = VE.elements;
    
    // Render label in the left column
    if (labelsColumn) {
      const labelEl = document.createElement('div');
      labelEl.className = `audio-track-label ${trackType}-label`;
      labelEl.innerHTML = `
        <i class="fas ${icon}"></i>
        <span>${label}</span>
      `;
      
      labelsColumn.appendChild(labelEl);
    }
    
    // Ensure audio track container exists in timeline
    let audioTrack = elements.timelineTracks.querySelector(`.${className}`);
    if (!audioTrack) {
      audioTrack = document.createElement('div');
      audioTrack.className = `audio-track ${className}`;
      audioTrack.dataset.trackType = trackType;
      audioTrack.innerHTML = `<div class="audio-track-content"></div>`;
      elements.timelineTracks.appendChild(audioTrack);
    }
    
    const audioContent = audioTrack.querySelector('.audio-track-content');
    
    // Calculate timeline width if not provided
    if (!timelineWidth) {
      const maxDuration = Math.max(VE.state.totalDuration, VE.state.audioDuration || 0);
      timelineWidth = Math.max(1000, maxDuration * VE.state.zoomLevel + 20); // Small padding only
    }
    
    // Set width on the audio track itself so background extends fully
    // Use width (not just min-width) so the scroll container knows the full width
    audioTrack.style.width = `${timelineWidth}px`;
    audioTrack.style.minWidth = `${timelineWidth}px`;
    // Also set on content for proper segment positioning
    audioContent.style.width = `${timelineWidth}px`;
    audioContent.style.minWidth = `${timelineWidth}px`;
    
    audioContent.innerHTML = '';
    
    // Render audio segments
    timeline.forEach((segment, index) => {
      const segmentEl = VE.createAudioSegmentElement(segment, index, trackType);
      audioContent.appendChild(segmentEl);
    });
  }

  VE.toggleAudioTrackMute = function(trackType) {
    if (trackType === 'detached') {
      VE.state.isDetachedAudioMuted = !VE.state.isDetachedAudioMuted;
      // Update audio elements for detached track
      VE.state.detachedAudioTimeline.forEach(segment => {
        const audio = VE.state.audioElements.get(segment.id);
        if (audio) audio.muted = VE.state.isDetachedAudioMuted;
      });
      VE.showToast('info', VE.state.isDetachedAudioMuted ? 'Detached Audio Muted' : 'Detached Audio Unmuted');
    } else {
      VE.state.isCustomAudioMuted = !VE.state.isCustomAudioMuted;
      // Update audio elements for custom track
      VE.state.customAudioTimeline.forEach(segment => {
        const audio = VE.state.audioElements.get(segment.id);
        if (audio) audio.muted = VE.state.isCustomAudioMuted;
      });
      VE.showToast('info', VE.state.isCustomAudioMuted ? 'Custom Audio Muted' : 'Custom Audio Unmuted');
    }
    
    VE.renderTimeline();
  };

  VE.createAudioSegmentElement = function(segment, index, trackType) {
    const el = document.createElement('div');
    const xOffset = segment.timelineStart * VE.state.zoomLevel;
    const durationWidth = (segment.endOffset - segment.startOffset) * VE.state.zoomLevel;
    const width = Math.max(VE.MIN_SEGMENT_WIDTH, durationWidth);
    const isSelected = VE.state.selectedAudioSegment === segment.id;
    const isSmallClip = width < VE.SMALL_CLIP_THRESHOLD;
    const isDetached = trackType === 'detached';
    
    el.className = `audio-segment ${isSelected ? 'selected' : ''} ${isSmallClip ? 'small-clip' : ''} ${isDetached ? 'detached-audio' : 'custom-audio'}`;
    el.style.left = `${xOffset}px`;
    el.style.width = `${width}px`;
    el.style.background = VE.audioColors[segment.colorIndex || 0];
    el.dataset.id = segment.id;
    el.dataset.trackType = trackType;
    
    // Audio segments: no thumbnails, just name and duration
    // If waveforms are needed in the future, they should fit within the 50px height
    el.innerHTML = `
      <div class="trim-handle trim-handle-left" data-side="left"></div>
      <div class="segment-info">
        <div class="segment-name">${segment.name.substring(0, 20)}${segment.name.length > 20 ? '...' : ''}</div>
        <div class="segment-duration">${VE.formatTimeShort(segment.endOffset - segment.startOffset)}</div>
      </div>
      <button class="segment-delete-btn" title="Delete clip"><i class="fas fa-trash"></i></button>
      <div class="trim-handle trim-handle-right" data-side="right"></div>
    `;

    // Delete button
    el.querySelector('.segment-delete-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      VE.removeAudioSegment(segment.id, trackType);
    });

    // Trim handles
    const leftHandle = el.querySelector('.trim-handle-left');
    const rightHandle = el.querySelector('.trim-handle-right');
    
    setupAudioTrimHandle(leftHandle, segment, 'left', el, trackType);
    setupAudioTrimHandle(rightHandle, segment, 'right', el, trackType);

    el.addEventListener('click', (e) => {
      if (!e.target.closest('.trim-handle') && !e.target.closest('.segment-delete-btn')) {
        VE.selectAudioSegment(segment.id);
      }
    });
    
    // Setup drag to reposition audio on timeline
    setupAudioDrag(el, segment, trackType);

    return el;
  };

  // Audio segment drag to reposition
  // Check if a position would cause overlap with other segments in the same track
  function checkAudioOverlap(timeline, segmentId, newStart, duration) {
    for (const otherSeg of timeline) {
      if (otherSeg.id === segmentId) continue; // Skip self
      
      const otherStart = otherSeg.timelineStart;
      const otherEnd = otherStart + (otherSeg.endOffset - otherSeg.startOffset);
      const newEnd = newStart + duration;
      
      // Check for overlap: segments overlap if one starts before the other ends
      if (newStart < otherEnd && newEnd > otherStart) {
        return { overlaps: true, otherStart, otherEnd };
      }
    }
    return { overlaps: false };
  }
  
  // Find the nearest valid position that doesn't overlap
  function findNearestValidPosition(timeline, segmentId, desiredStart, duration) {
    const { overlaps, otherStart, otherEnd } = checkAudioOverlap(timeline, segmentId, desiredStart, duration);
    
    if (!overlaps) {
      return Math.max(0, desiredStart);
    }
    
    // Find closest non-overlapping position
    const desiredEnd = desiredStart + duration;
    const desiredMid = desiredStart + duration / 2;
    
    // Calculate distances to place before or after the blocking segment
    const distToBefore = Math.abs(desiredMid - (otherStart - duration / 2));
    const distToAfter = Math.abs(desiredMid - (otherEnd + duration / 2));
    
    // Choose the closer option
    if (distToBefore <= distToAfter && otherStart - duration >= 0) {
      // Place before the blocking segment
      return Math.max(0, otherStart - duration);
    } else {
      // Place after the blocking segment
      return otherEnd;
    }
  }

  function setupAudioDrag(el, segment, trackType) {
    let isDragging = false;
    let hasMoved = false;
    let startX = 0;
    let startTimelineStart = 0;
    let segmentDuration = 0;
    const DRAG_THRESHOLD = 5; // Pixels before considering it a drag
    
    el.addEventListener('mousedown', (e) => {
      // Don't start drag from trim handles or delete button
      if (e.target.closest('.trim-handle') || e.target.closest('.segment-delete-btn')) {
        return;
      }
      
      // Don't prevent default immediately - let click events work
      isDragging = true;
      hasMoved = false;
      startX = e.clientX;
      startTimelineStart = segment.timelineStart;
      segmentDuration = segment.endOffset - segment.startOffset;
      
      const onMouseMove = (e) => {
        if (!isDragging) return;
        
        const deltaX = e.clientX - startX;
        
        // Only start actual drag if moved beyond threshold
        if (!hasMoved && Math.abs(deltaX) < DRAG_THRESHOLD) {
          return;
        }
        
        // First move beyond threshold - start drag
        if (!hasMoved) {
          hasMoved = true;
          el.classList.add('dragging');
          document.body.style.cursor = 'grabbing';
          document.body.style.userSelect = 'none';
        }
        
        // Use safe zoom level to prevent division by zero
        const safeZoomLevel = typeof VE.getZoomForCalculations === 'function' 
          ? VE.getZoomForCalculations() 
          : Math.max(VE.state.zoomLevel, 0.1);
        const deltaTime = deltaX / safeZoomLevel;
        
        // Get the timeline array
        const timeline = trackType === 'detached' 
          ? VE.state.detachedAudioTimeline 
          : VE.state.customAudioTimeline;
        
        const seg = timeline.find(s => s.id === segment.id);
        if (!seg) return;
        
        // Calculate desired position
        let desiredStart = Math.max(0, startTimelineStart + deltaTime);
        
        // Check for overlaps and find valid position
        const validPosition = findNearestValidPosition(timeline, segment.id, desiredStart, segmentDuration);
        
        // Update timeline position
        seg.timelineStart = validPosition;
        
        // Update visual position
        el.style.left = `${validPosition * VE.state.zoomLevel}px`;
        
        // Visual feedback if snapped to avoid overlap
        if (Math.abs(validPosition - desiredStart) > 0.1) {
          el.classList.add('snapped');
        } else {
          el.classList.remove('snapped');
        }
      };
      
      const onMouseUp = () => {
        isDragging = false;
        
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        
        if (hasMoved) {
          el.classList.remove('dragging', 'snapped');
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
          
          // Update audio duration and re-render to clean up
          VE.updateAudioDuration();
          VE.renderTimeline();
        }
        // If not moved, let the click event handle selection
      };
      
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }

  function setupAudioTrimHandle(handle, segment, side, segmentEl, trackType) {
    let startX = 0;
    let startOffset = 0;
    let segmentId = segment.id;
    let originalEnd = segment.endOffset;
    let originalTimelineStart = segment.timelineStart;
    
    const getTimeline = () => trackType === 'detached' ? VE.state.detachedAudioTimeline : VE.state.customAudioTimeline;
    
    // Find the maximum/minimum bounds based on neighboring segments
    const getTrimBounds = (seg, timeline) => {
      let minTimelineStart = 0;
      let maxTimelineEnd = Infinity;
      
      for (const otherSeg of timeline) {
        if (otherSeg.id === segmentId) continue;
        
        const otherStart = otherSeg.timelineStart;
        const otherEnd = otherStart + (otherSeg.endOffset - otherSeg.startOffset);
        const segEnd = seg.timelineStart + (seg.endOffset - seg.startOffset);
        
        // Segment to the left - sets our minimum start
        if (otherEnd <= seg.timelineStart + 0.01) {
          minTimelineStart = Math.max(minTimelineStart, otherEnd);
        }
        
        // Segment to the right - sets our maximum end
        if (otherStart >= segEnd - 0.01) {
          maxTimelineEnd = Math.min(maxTimelineEnd, otherStart);
        }
      }
      
      return { minTimelineStart, maxTimelineEnd };
    };
    
    const onMouseMoveRaw = (e) => {
      const deltaX = e.clientX - startX;
      const deltaTime = deltaX / VE.getZoomForCalculations();
      const timeline = getTimeline();
      const segIndex = timeline.findIndex(s => s.id === segmentId);
      if (segIndex === -1) return;
      
      const seg = timeline[segIndex];
      const minDuration = 0.5;
      const { minTimelineStart, maxTimelineEnd } = getTrimBounds(seg, timeline);
      
      if (side === 'left') {
        const newStart = Math.max(0, Math.min(startOffset + deltaTime, originalEnd - minDuration));
        const startDiff = newStart - seg.startOffset;
        const newTimelineStart = Math.max(0, originalTimelineStart + startDiff);
        
        // Check overlap constraint
        if (newTimelineStart >= minTimelineStart) {
          seg.startOffset = newStart;
          seg.timelineStart = newTimelineStart;
        } else {
          // Snap to the boundary
          const allowedTimelineStart = minTimelineStart;
          const allowedStartDiff = allowedTimelineStart - originalTimelineStart;
          seg.startOffset = Math.max(0, seg.startOffset + allowedStartDiff);
          seg.timelineStart = allowedTimelineStart;
        }
      } else {
        const maxEnd = seg.originalDuration;
        const newEnd = Math.max(seg.startOffset + minDuration, Math.min(startOffset + deltaTime, maxEnd));
        const newDuration = newEnd - seg.startOffset;
        const newTimelineEnd = seg.timelineStart + newDuration;
        
        // Check overlap constraint
        if (newTimelineEnd <= maxTimelineEnd) {
          seg.endOffset = newEnd;
        } else {
          // Snap to the boundary
          const allowedDuration = maxTimelineEnd - seg.timelineStart;
          seg.endOffset = seg.startOffset + Math.max(minDuration, allowedDuration);
        }
      }
      
      const newWidth = Math.max(VE.MIN_SEGMENT_WIDTH, (seg.endOffset - seg.startOffset) * VE.state.zoomLevel);
      segmentEl.style.width = `${newWidth}px`;
      segmentEl.style.left = `${seg.timelineStart * VE.state.zoomLevel}px`;
      
      const durationEl = segmentEl.querySelector('.segment-duration');
      if (durationEl) {
        durationEl.textContent = VE.formatTimeShort(seg.endOffset - seg.startOffset);
      }
      
      VE.updateAudioDuration();
    };
    
    const onMouseMove = VE.throttle(onMouseMoveRaw, 16);
    
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      segmentEl.classList.remove('trimming');
      VE.renderTimeline();
      // Auto-save progress after audio trim
      if (typeof VE.scheduleProgressSave === 'function') {
        VE.scheduleProgressSave();
      }
    };
    
    handle.addEventListener('mousedown', function(e) {
      e.stopPropagation();
      e.preventDefault();
      
      startX = e.clientX;
      const timeline = getTimeline();
      const seg = timeline.find(s => s.id === segmentId);
      if (!seg) return;
      
      startOffset = side === 'left' ? seg.startOffset : seg.endOffset;
      originalEnd = seg.endOffset;
      originalTimelineStart = seg.timelineStart;
      
      segmentEl.classList.add('trimming');
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
      
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    }, true);
  }

  VE.selectAudioSegment = function(segmentId) {
    VE.state.selectedAudioSegment = VE.state.selectedAudioSegment === segmentId ? null : segmentId;
    VE.state.selectedSegment = null; // Deselect video segment
    VE.renderTimeline();
    VE.updateDownloadButtonVisibility();
  };

  VE.removeAudioSegment = function(segmentId, trackType) {
    // Clean up audio element
    if (VE.state.audioElements.has(segmentId)) {
      const audio = VE.state.audioElements.get(segmentId);
      audio.pause();
      audio.src = '';
      VE.state.audioElements.delete(segmentId);
    }
    
    // Remove from appropriate timeline
    if (trackType === 'detached') {
      VE.state.detachedAudioTimeline = VE.state.detachedAudioTimeline.filter(s => s.id !== segmentId);
    } else {
      VE.state.customAudioTimeline = VE.state.customAudioTimeline.filter(s => s.id !== segmentId);
    }
    
    if (VE.state.selectedAudioSegment === segmentId) {
      VE.state.selectedAudioSegment = null;
    }
    VE.updateAudioDuration();
    VE.renderTimeline();
    VE.updateDownloadButtonVisibility();
    VE.showToast('info', 'Audio Removed');
    // Auto-save progress
    if (typeof VE.scheduleProgressSave === 'function') {
      VE.scheduleProgressSave();
    }
  };

  // ============================================
  // Detach Audio from Video
  // ============================================
  VE.detachAudioFromSegment = function(segmentId, segmentIndex) {
    const segment = VE.state.timeline.find(s => s.id === segmentId);
    if (!segment || segment.type !== 'video') return;
    
    // Check if already detached
    if (segment.audioDetached) {
      VE.showToast('warning', 'Already Detached', 'Audio was already detached from this clip');
      return;
    }
    
    const asset = VE.state.assets.find(a => a.id === segment.assetId);
    if (!asset) return;
    
    // Calculate the timeline position where this segment starts
    let timelinePosition = 0;
    for (let i = 0; i < segmentIndex; i++) {
      const seg = VE.state.timeline[i];
      timelinePosition += (seg.endOffset - seg.startOffset);
    }
    
    // Create audio segment from video
    const audioSegment = {
      id: VE.generateId(),
      assetId: asset.id, // Use the same video asset for audio extraction
      sourceSegmentId: segmentId, // Reference to original video segment
      name: asset.name + ' (Audio)',
      type: 'audio',
      isDetachedAudio: true, // Mark as detached from video
      duration: segment.originalDuration,
      startOffset: segment.startOffset,
      endOffset: segment.endOffset,
      originalDuration: segment.originalDuration,
      timelineStart: timelinePosition,
      volume: 1.0,
      colorIndex: VE.state.detachedAudioTimeline.length % VE.audioColors.length,
      thumbnail: null
    };
    
    // Mark video segment as having audio detached (video will be muted)
    segment.audioDetached = true;
    
    // Add to DETACHED audio timeline
    VE.state.detachedAudioTimeline.push(audioSegment);
    VE.updateAudioDuration();
    VE.renderTimeline();
    
    VE.showToast('success', 'Audio Detached', 'Video is now muted. Audio moved to Detached track.');
    // Auto-save progress
    if (typeof VE.scheduleProgressSave === 'function') {
      VE.scheduleProgressSave();
    }
  };

  // Detach audio from currently selected segment
  VE.detachAudioFromSelected = function() {
    if (!VE.state.selectedSegment) {
      VE.showToast('info', 'No Selection', 'Select a video clip first');
      return;
    }
    
    const segmentIndex = VE.state.timeline.findIndex(s => s.id === VE.state.selectedSegment);
    if (segmentIndex === -1) return;
    
    const segment = VE.state.timeline[segmentIndex];
    
    if (segment.type !== 'video') {
      VE.showToast('warning', 'Not a Video', 'Detach audio only works on video clips');
      return;
    }
    
    VE.detachAudioFromSegment(VE.state.selectedSegment, segmentIndex);
  };

  // ============================================
  // Frame Extraction for Filmstrip Thumbnails
  // ============================================
  
  /**
   * Generate multiple frames from a video segment for filmstrip display
   * @param {Object} segment - The timeline segment
   * @param {number} frameCount - Number of frames to extract
   * @returns {Promise<Array<string>>} Array of frame data URLs
   */
  VE.generateSegmentFrames = async function(segment, frameCount) {
    // Only extract frames for video segments
    if (segment.type !== 'video') {
      return null;
    }
    
    // Check if frames are already cached
    const cacheKey = `${segment.id}_${segment.startOffset}_${segment.endOffset}_${frameCount}`;
    if (segment._frameCache && segment._frameCacheKey === cacheKey && segment._frameCache.length === frameCount) {
      return segment._frameCache;
    }
    
    // Find the video asset
    const asset = VE.state.assets.find(a => a.id === segment.assetId);
    if (!asset) {
      console.warn('Asset not found for segment:', segment.id);
      return null;
    }
    
    // Get video URL (prefer objectUrl, then serverUrl, then remoteUrl)
    const videoUrl = asset.objectUrl || asset.serverUrl || asset.remoteUrl || asset.video_url;
    if (!videoUrl) {
      console.warn('No video URL available for asset:', asset.id);
      return null;
    }
    
    // Calculate segment duration
    const segmentDuration = segment.endOffset - segment.startOffset;
    if (segmentDuration <= 0) {
      return null;
    }
    
    // For very short segments, use fewer frames
    const actualFrameCount = segmentDuration < 0.5 ? Math.min(2, frameCount) : frameCount;
    
    try {
      // Create a hidden video element for frame extraction
      const tempVideo = document.createElement('video');
      tempVideo.preload = 'metadata';
      tempVideo.crossOrigin = 'anonymous';
      tempVideo.muted = true;
      tempVideo.playsInline = true;
      tempVideo.style.display = 'none';
      tempVideo.style.position = 'absolute';
      tempVideo.style.width = '1px';
      tempVideo.style.height = '1px';
      tempVideo.style.opacity = '0';
      tempVideo.style.pointerEvents = 'none';
      document.body.appendChild(tempVideo);
      
      // Load video and extract frames
      const frames = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error('Video loading timeout'));
        }, 15000); // 15 second timeout
        
        const cleanup = () => {
          clearTimeout(timeout);
          if (tempVideo.parentNode) {
            tempVideo.parentNode.removeChild(tempVideo);
          }
          tempVideo.src = '';
          tempVideo.load();
        };
        
        tempVideo.onerror = (e) => {
          cleanup();
          reject(new Error('Video loading failed'));
        };
        
        tempVideo.onloadedmetadata = async () => {
          try {
            const extractedFrames = [];
            const canvas = document.createElement('canvas');
            canvas.width = 160;
            canvas.height = 90;
            const ctx = canvas.getContext('2d');
            
            // Extract frames at evenly distributed time points
            for (let i = 0; i < actualFrameCount; i++) {
              // Handle single frame case (avoid division by zero)
              const timeInSegment = actualFrameCount === 1 
                ? segmentDuration / 2  // Use middle of segment for single frame
                : (i / (actualFrameCount - 1)) * segmentDuration;
              const videoTime = segment.startOffset + timeInSegment;
              
              // Clamp to valid video time
              const clampedTime = Math.max(0, Math.min(videoTime, tempVideo.duration || videoTime));
              
              // Seek to frame time
              await new Promise((seekResolve, seekReject) => {
                const seekTimeout = setTimeout(() => {
                  seekReject(new Error('Seek timeout'));
                }, 3000);
                
                tempVideo.onseeked = () => {
                  clearTimeout(seekTimeout);
                  try {
                    // Draw frame to canvas
                    ctx.drawImage(tempVideo, 0, 0, canvas.width, canvas.height);
                    const frameDataUrl = canvas.toDataURL('image/jpeg', 0.7);
                    extractedFrames.push(frameDataUrl);
                    seekResolve();
                  } catch (e) {
                    // CORS or other error - skip this frame
                    console.warn('Frame extraction failed:', e);
                    seekReject(e);
                  }
                };
                
                tempVideo.onerror = () => {
                  clearTimeout(seekTimeout);
                  seekReject(new Error('Seek error'));
                };
                
                tempVideo.currentTime = clampedTime;
              }).catch(() => {
                // Skip failed frames, continue with others
              });
            }
            
            cleanup();
            
            // Cache frames in segment
            segment._frameCache = extractedFrames;
            segment._frameCacheKey = cacheKey;
            
            resolve(extractedFrames.length > 0 ? extractedFrames : null);
          } catch (e) {
            cleanup();
            reject(e);
          }
        };
        
        tempVideo.src = videoUrl;
      });
      
      return frames;
    } catch (error) {
      console.warn('Frame extraction failed for segment:', segment.id, error);
      return null;
    }
  };
  
  /**
   * Calculate the number of frames to show based on segment width
   * @param {number} width - Segment width in pixels
   * @param {boolean} isSmallClip - Whether segment is a small clip
   * @param {number} segmentDuration - Segment duration in seconds
   * @returns {number} Number of frames to extract
   */
  VE.calculateFrameCount = function(width, isSmallClip, segmentDuration) {
    // For very short segments (< 0.5s), use 1-2 frames
    if (segmentDuration < 0.5) {
      return 1;
    }
    
    // For small clips, use fewer frames
    if (isSmallClip) {
      return Math.min(3, Math.max(2, Math.floor(width / 40)));
    }
    
    // Base calculation: approximately 1 frame per 60px
    const baseCount = Math.floor(width / 60);
    
    // Clamp between 3 and 15 frames
    return Math.min(15, Math.max(3, baseCount));
  };

  VE.createSegmentElement = function(segment, index, xOffset) {
    const el = document.createElement('div');
    const durationWidth = (segment.endOffset - segment.startOffset) * VE.state.zoomLevel;
    // Use a smaller minimum width to reduce overlap issues
    const width = Math.max(VE.MIN_SEGMENT_WIDTH, durationWidth);
    const isSelected = VE.state.selectedSegment === segment.id;
    const isTextFrame = segment.type === 'text';
    const isImageFrame = segment.type === 'image';
    const isSmallClip = width < VE.SMALL_CLIP_THRESHOLD;
    const hasCrop = segment.crop && segment.crop.width > 0;
    const segmentDuration = segment.endOffset - segment.startOffset;
    
    const hasAudioDetached = segment.audioDetached === true;
    el.className = `timeline-segment ${isSelected ? 'selected' : ''} ${isTextFrame ? 'text-frame' : ''} ${isImageFrame ? 'image-frame' : ''} ${isSmallClip ? 'small-clip' : ''} ${hasCrop ? 'has-crop' : ''} ${hasAudioDetached ? 'audio-detached' : ''}`;
    el.style.left = `${xOffset}px`;
    el.style.width = `${width}px`;
    // Store actual duration width for calculations
    el.dataset.durationWidth = durationWidth.toString();
    el.dataset.audioDetached = hasAudioDetached ? 'true' : 'false';
    if (isTextFrame) {
      el.style.background = 'linear-gradient(135deg, #a855f7 0%, #7c3aed 100%)';
    } else if (isImageFrame) {
      el.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
    } else {
      el.style.background = VE.clipColors[segment.colorIndex || 0];
    }
    el.dataset.id = segment.id;
    
    // Generate thumbnail HTML - use filmstrip for video segments, single thumbnail for others
    let thumbnailHtml = '';
    if (segment.type === 'video') {
      // Calculate frame count based on width
      const frameCount = VE.calculateFrameCount(width, isSmallClip, segmentDuration);
      
      // Check if we have cached frames
      const cacheKey = `${segment.id}_${segment.startOffset}_${segment.endOffset}_${frameCount}`;
      const hasCachedFrames = segment._frameCache && segment._frameCacheKey === cacheKey && segment._frameCache.length === frameCount;
      
      if (hasCachedFrames && segment._frameCache.length > 0) {
        // Use cached frames to build filmstrip
        const frameElements = segment._frameCache.map((frameUrl, i) => 
          `<div class="filmstrip-frame" style="background-image: url('${frameUrl}')"></div>`
        ).join('');
        thumbnailHtml = `<div class="segment-filmstrip">${frameElements}</div>`;
        // Add class to segment for styling
        el.classList.add('has-filmstrip');
      } else {
        // Show loading state - use thumbnail as background if available, with loading overlay
        if (segment.thumbnail) {
          thumbnailHtml = `<div class="segment-thumbnail"><img src="${segment.thumbnail}" alt=""></div>`;
        } else {
          thumbnailHtml = '<div class="segment-filmstrip-loading"></div>';
        }
        // Add loading overlay and class to segment
        el.classList.add('has-filmstrip', 'loading-frames');
        
        // Generate frames asynchronously
        VE.generateSegmentFrames(segment, frameCount).then(frames => {
          // Remove loading class
          el.classList.remove('loading-frames');
          
          if (frames && frames.length > 0) {
            // Remove thumbnail if it exists, replace with filmstrip
            const existingThumbnail = el.querySelector('.segment-thumbnail');
            const existingLoading = el.querySelector('.segment-filmstrip-loading');
            
            if (existingThumbnail) {
              existingThumbnail.remove();
            }
            if (existingLoading) {
              existingLoading.remove();
            }
            
            // Create and insert filmstrip
            const frameElements = frames.map((frameUrl, i) => 
              `<div class="filmstrip-frame" style="background-image: url('${frameUrl}')"></div>`
            ).join('');
            const filmstripDiv = document.createElement('div');
            filmstripDiv.className = 'segment-filmstrip';
            filmstripDiv.innerHTML = frameElements;
            el.insertBefore(filmstripDiv, el.firstChild);
          } else {
            // Fallback: keep thumbnail if it exists, or show placeholder
            el.classList.remove('has-filmstrip');
            if (!segment.thumbnail) {
              const existingLoading = el.querySelector('.segment-filmstrip-loading');
              if (existingLoading) {
                existingLoading.remove();
              }
            }
          }
        }).catch(err => {
          console.warn('Frame generation failed, using fallback:', err);
          // Remove loading class
          el.classList.remove('loading-frames');
          // Fallback: keep thumbnail if it exists
          if (!segment.thumbnail) {
            el.classList.remove('has-filmstrip');
            const existingLoading = el.querySelector('.segment-filmstrip-loading');
            if (existingLoading) {
              existingLoading.remove();
            }
          }
        });
      }
    } else {
      // For non-video segments (text, image), use single thumbnail
      thumbnailHtml = segment.thumbnail ? 
        `<div class="segment-thumbnail"><img src="${segment.thumbnail}" alt=""></div>` : 
        '';
    }
    
    el.innerHTML = `
      <div class="trim-handle trim-handle-left" data-side="left"></div>
      ${thumbnailHtml}
      <div class="segment-info">
        <div class="segment-name">${segment.name.substring(0, 20)}${segment.name.length > 20 ? '...' : ''}</div>
        <div class="segment-duration">${VE.formatTimeShort(segment.endOffset - segment.startOffset)}</div>
      </div>
      <button class="segment-delete-btn" title="Delete clip"><i class="fas fa-trash"></i></button>
      <div class="trim-handle trim-handle-right" data-side="right"></div>
    `;

    // Delete button
    el.querySelector('.segment-delete-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      VE.state.timeline = VE.state.timeline.filter(s => s.id !== segment.id);
      if (VE.state.selectedSegment === segment.id) {
        VE.state.selectedSegment = null;
        VE.updateDownloadButtonVisibility();
      }
      VE.renderTimeline();
      VE.showToast('info', 'Clip Removed');
      // Auto-save progress to database
      if (typeof VE.scheduleProgressSave === 'function') {
        VE.scheduleProgressSave();
      }
    });

    // Trim handles
    const leftHandle = el.querySelector('.trim-handle-left');
    const rightHandle = el.querySelector('.trim-handle-right');
    
    setupTrimHandle(leftHandle, segment, 'left', el);
    setupTrimHandle(rightHandle, segment, 'right', el);

    el.addEventListener('click', (e) => {
      if (!e.target.closest('.trim-handle') && !e.target.closest('.segment-delete-btn')) {
        VE.selectSegment(segment.id);
      }
    });
    
    el.addEventListener('dblclick', (e) => {
      if (e.target.closest('.trim-handle') || e.target.closest('.segment-delete-btn')) return;
      if (segment.type === 'text') {
        VE.openTextModal(segment);
      } else if (segment.type === 'image') {
        VE.openImageModal(segment);
      } else {
        const asset = VE.state.assets.find(a => a.id === segment.assetId);
        if (asset) {
          VE.loadVideoToPreview(asset, segment);
          VE.elements.previewVideo.currentTime = segment.startOffset;
        }
      }
    });

    // Disable native drag on trim handles
    leftHandle.draggable = false;
    rightHandle.draggable = false;
    
    // Make segment draggable but not from handles
    el.addEventListener('mousedown', (e) => {
      if (e.target.closest('.trim-handle') || e.target.closest('.segment-delete-btn')) {
        el.draggable = false;
      } else {
        el.draggable = true;
      }
    });
    
    el.addEventListener('dragstart', (e) => {
      if (e.target.closest('.trim-handle') || e.target.closest('.segment-delete-btn')) {
        e.preventDefault();
        return;
      }
      dragState.draggingIndex = index;
      dragState.isDragging = true;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', index.toString());
      
      // Delay the opacity change so the drag image is captured first
      setTimeout(() => {
        el.classList.add('dragging');
      }, 0);
    });
    
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      el.draggable = true;
      dragState.isDragging = false;
      dragState.draggingIndex = -1;
      dragState.dropTargetIndex = -1;
      
      // Clean up drop indicators
      removeDropIndicators();
    });
    
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      
      if (dragState.draggingIndex === -1 || dragState.draggingIndex === index) return;
      
      const rect = el.getBoundingClientRect();
      const midPoint = rect.left + rect.width / 2;
      const insertBefore = e.clientX < midPoint;
      
      // Calculate target index
      let targetIndex = insertBefore ? index : index + 1;
      if (dragState.draggingIndex < index) {
        targetIndex = insertBefore ? index : index + 1;
      } else {
        targetIndex = insertBefore ? index : index + 1;
      }
      
      if (dragState.dropTargetIndex !== targetIndex) {
        dragState.dropTargetIndex = targetIndex;
        showDropIndicator(el, insertBefore);
      }
    });
    
    el.addEventListener('dragleave', (e) => {
      // Only remove if actually leaving the element
      if (!el.contains(e.relatedTarget)) {
        removeDropIndicatorFromElement(el);
      }
    });
    
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      
      const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
      if (isNaN(fromIndex) || fromIndex === index) {
        removeDropIndicators();
        return;
      }
      
      const rect = el.getBoundingClientRect();
      const midPoint = rect.left + rect.width / 2;
      const insertBefore = e.clientX < midPoint;
      
      let toIndex = insertBefore ? index : index + 1;
      
      // Adjust toIndex if dragging from before the drop position
      if (fromIndex < toIndex) {
        toIndex--;
      }
      
      // Reorder the timeline
      VE.reorderTimeline(fromIndex, toIndex);
      removeDropIndicators();
    });

    return el;
  };

  function showDropIndicator(element, insertBefore) {
    removeDropIndicators();
    
    const videoTrackArea = VE.elements.timelineTracks.querySelector('.video-track-area');
    if (!videoTrackArea) return;
    
    const indicator = document.createElement('div');
    indicator.className = 'drop-indicator';
    
    indicator.style.position = 'absolute';
    indicator.style.top = '8px';
    indicator.style.bottom = '8px';
    indicator.style.width = '4px';
    indicator.style.background = 'var(--accent-blue)';
    indicator.style.borderRadius = '2px';
    indicator.style.zIndex = '200';
    indicator.style.boxShadow = '0 0 10px var(--accent-blue)';
    
    if (insertBefore) {
      indicator.style.left = `${parseFloat(element.style.left) - 2}px`;
    } else {
      indicator.style.left = `${parseFloat(element.style.left) + parseFloat(element.style.width) + 2}px`;
    }
    
    videoTrackArea.appendChild(indicator);
  }

  function removeDropIndicators() {
    const videoTrackArea = VE.elements.timelineTracks.querySelector('.video-track-area');
    if (videoTrackArea) {
      const indicators = videoTrackArea.querySelectorAll('.drop-indicator');
      indicators.forEach(ind => ind.remove());
      
      const segments = videoTrackArea.querySelectorAll('.timeline-segment');
      segments.forEach(seg => {
        seg.classList.remove('drop-left', 'drop-right');
      });
    }
  }

  function removeDropIndicatorFromElement(element) {
    element.classList.remove('drop-left', 'drop-right');
  }

  VE.reorderTimeline = function(fromIndex, toIndex) {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
    if (fromIndex >= VE.state.timeline.length) return;
    
    // Clamp toIndex
    toIndex = Math.min(toIndex, VE.state.timeline.length - 1);
    toIndex = Math.max(toIndex, 0);
    
    // Remove the item from the original position
    const [movedItem] = VE.state.timeline.splice(fromIndex, 1);
    
    // Insert at the new position
    VE.state.timeline.splice(toIndex, 0, movedItem);
    
    // Re-render the timeline
    VE.renderTimeline();
    VE.showToast('success', 'Clip Moved', 'Timeline order updated');
    // Auto-save progress after reorder
    if (typeof VE.scheduleProgressSave === 'function') {
      VE.scheduleProgressSave();
    }
  };

  function setupTrimHandle(handle, segment, side, segmentEl) {
    let startX = 0;
    let startOffset = 0;
    let segmentId = segment.id;
    let originalEnd = segment.endOffset;
    let originalLeft = 0;
    let originalStartOffset = 0;
    
    // Raw mouse move handler (will be throttled when added as listener)
    const onMouseMoveRaw = (e) => {
      const deltaX = e.clientX - startX;
      const deltaTime = deltaX / VE.getZoomForCalculations();
      const segIndex = VE.state.timeline.findIndex(s => s.id === segmentId);
      if (segIndex === -1) return;
      
      const seg = VE.state.timeline[segIndex];
      const minDuration = 0.5; // Minimum 0.5 second
      
      if (side === 'left') {
        const newStart = Math.max(0, Math.min(startOffset + deltaTime, originalEnd - minDuration));
        seg.startOffset = newStart;
        
        // Update visual left position for proper feedback during left trim
        const startChange = (newStart - originalStartOffset) * VE.state.zoomLevel;
        segmentEl.style.left = `${originalLeft + startChange}px`;
      } else {
        const maxEnd = seg.originalDuration;
        const newEnd = Math.max(seg.startOffset + minDuration, Math.min(startOffset + deltaTime, maxEnd));
        seg.endOffset = newEnd;
      }
      
      // Update the element width and duration display directly without full re-render
      const newWidth = Math.max(VE.MIN_SEGMENT_WIDTH, (seg.endOffset - seg.startOffset) * VE.state.zoomLevel);
      segmentEl.style.width = `${newWidth}px`;
      
      // Update small-clip class based on new width
      if (newWidth < VE.SMALL_CLIP_THRESHOLD) {
        segmentEl.classList.add('small-clip');
      } else {
        segmentEl.classList.remove('small-clip');
      }
      
      const durationEl = segmentEl.querySelector('.segment-duration');
      if (durationEl) {
        durationEl.textContent = VE.formatTimeShort(seg.endOffset - seg.startOffset);
      }
      
      VE.updateTotalDuration();
    };
    
    // Throttled version for smooth 60fps trimming
    const onMouseMove = VE.throttle(onMouseMoveRaw, 16);
    
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      segmentEl.classList.remove('trimming');
      console.log('Trim ended');
      
      // Invalidate frame cache for trimmed segment so frames are regenerated
      const segIndex = VE.state.timeline.findIndex(s => s.id === segmentId);
      if (segIndex !== -1) {
        const seg = VE.state.timeline[segIndex];
        if (seg.type === 'video') {
          // Clear frame cache to force regeneration with new trim points
          seg._frameCache = null;
          seg._frameCacheKey = null;
        }
      }
      
      // Full re-render on mouse up to recalculate positions
      VE.renderTimeline();
      // Auto-save progress after trim
      if (typeof VE.scheduleProgressSave === 'function') {
        VE.scheduleProgressSave();
      }
    };
    
    handle.addEventListener('mousedown', function(e) {
      e.stopPropagation();
      e.preventDefault();
      e.stopImmediatePropagation();
      
      startX = e.clientX;
      const seg = VE.state.timeline.find(s => s.id === segmentId);
      if (!seg) {
        console.error('Trim: segment not found', segmentId);
        return;
      }
      startOffset = side === 'left' ? seg.startOffset : seg.endOffset;
      originalEnd = seg.endOffset;
      originalStartOffset = seg.startOffset;
      originalLeft = parseFloat(segmentEl.style.left) || 0;
      
      // Add trimming class to disable transitions
      segmentEl.classList.add('trimming');
      
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
      
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      
      console.log('Trim started:', side, 'segment:', seg.name);
    }, true);
  }

  VE.selectSegment = function(segmentId) {
    VE.state.selectedSegment = VE.state.selectedSegment === segmentId ? null : segmentId;
    VE.state.selectedAudioSegment = null; // Deselect audio segment
    VE.renderTimeline();
    VE.updateDownloadButtonVisibility();
  };

  VE.removeSelectedSegment = function() {
    if (VE.state.selectedSegment) {
      VE.state.timeline = VE.state.timeline.filter(s => s.id !== VE.state.selectedSegment);
      VE.state.selectedSegment = null;
      VE.renderTimeline();
      VE.updateDownloadButtonVisibility();
      VE.showToast('info', 'Clip Removed');
      // Auto-save progress
      if (typeof VE.scheduleProgressSave === 'function') {
        VE.scheduleProgressSave();
      }
    }
  };

  VE.removeSelectedAudioSegment = function() {
    if (VE.state.selectedAudioSegment) {
      // Find which timeline the segment is in
      const detachedSegment = VE.state.detachedAudioTimeline.find(s => s.id === VE.state.selectedAudioSegment);
      const trackType = detachedSegment ? 'detached' : 'custom';
      VE.removeAudioSegment(VE.state.selectedAudioSegment, trackType);
    }
  };

  // ============================================
  // Download Button Visibility
  // ============================================
  VE.updateDownloadButtonVisibility = function() {
    const downloadBtn = VE.elements.downloadClipBtn;
    if (!downloadBtn) return;
    
    // Only show for detached audio segments
    let showDownload = false;
    if (VE.state.selectedAudioSegment) {
      const isDetached = VE.state.detachedAudioTimeline.some(s => s.id === VE.state.selectedAudioSegment);
      showDownload = isDetached;
    }
    
    downloadBtn.style.display = showDownload ? 'flex' : 'none';
  };

  // ============================================
  // Download Detached Audio
  // ============================================
  VE.downloadSelectedClip = async function() {
    // Only works for detached audio segments
    if (!VE.state.selectedAudioSegment) {
      VE.showToast('info', 'No Selection', 'Select a detached audio clip to download');
      return;
    }
    
    // Find the segment in detached audio timeline only
    const segment = VE.state.detachedAudioTimeline.find(s => s.id === VE.state.selectedAudioSegment);
    
    if (!segment) {
      VE.showToast('info', 'Not Detached Audio', 'Download only works for detached audio clips');
      return;
    }
    
    // Find the source video asset
    const asset = VE.state.assets.find(a => a.id === segment.assetId);
    if (!asset) {
      VE.showToast('error', 'Error', 'Could not find the source video for this audio');
      return;
    }
    
    const url = asset.objectUrl || asset.serverUrl || asset.remoteUrl;
    if (!url) {
      VE.showToast('error', 'Error', 'No source URL available');
      return;
    }
    
    // Calculate trim points
    const startOffset = segment.startOffset || 0;
    const endOffset = segment.endOffset || segment.duration;
    const clipDuration = endOffset - startOffset;
    
    console.log('Download detached audio:', {
      segmentId: segment.id,
      assetId: segment.assetId,
      url: url,
      startOffset,
      endOffset,
      clipDuration
    });
    
    VE.showToast('info', 'Preparing Audio...', 'Extracting audio from video...');
    
    try {
      // Load FFmpeg
      const loaded = await VE.loadFFmpeg();
      if (!loaded) {
        VE.showToast('error', 'Error', 'Could not load audio extraction engine');
        return;
      }
      
      const ffmpeg = VE.state.ffmpeg;
      
      // Fetch the source video file
      VE.showToast('info', 'Fetching source...', segment.name || 'audio');
      console.log('Fetching video from:', url);
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch video: ${response.status} ${response.statusText}`);
      }
      
      const arrayBuffer = await response.arrayBuffer();
      const sourceData = new Uint8Array(arrayBuffer);
      console.log('Fetched video size:', sourceData.byteLength);
      
      if (sourceData.byteLength < 1000) {
        throw new Error('Source file too small or empty');
      }
      
      const inputFile = `input_${Date.now()}.mp4`;
      const outputFile = `output_${Date.now()}.mp3`;
      
      // Write input file
      await ffmpeg.writeFile(inputFile, sourceData);
      console.log('Written input file:', inputFile);
      
      VE.showToast('info', 'Extracting audio...', `${clipDuration.toFixed(1)}s`);
      
      // Extract audio from video with trimming
      const ffmpegArgs = [
        '-ss', startOffset.toFixed(3),
        '-i', inputFile,
        '-t', clipDuration.toFixed(3),
        '-vn',  // No video
        '-acodec', 'libmp3lame',
        '-b:a', '192k',
        '-ar', '44100',
        '-ac', '2',
        '-y',
        outputFile
      ];
      
      console.log('FFmpeg args:', ffmpegArgs.join(' '));
      await ffmpeg.exec(ffmpegArgs);
      
      // Read output
      const outputData = await ffmpeg.readFile(outputFile);
      console.log('Output file size:', outputData?.byteLength);
      
      // Cleanup
      try { await ffmpeg.deleteFile(inputFile); } catch(e) {}
      try { await ffmpeg.deleteFile(outputFile); } catch(e) {}
      
      if (!outputData || outputData.byteLength < 100) {
        throw new Error('Audio extraction produced empty output');
      }
      
      // Create download
      const blob = new Blob([outputData], { type: 'audio/mpeg' });
      const downloadUrl = URL.createObjectURL(blob);
      
      const baseName = (segment.name || asset.name || 'audio').replace(/\.[^/.]+$/, '').replace(' (Audio)', '');
      const filename = `${baseName}_audio.mp3`;
      
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      
      VE.showToast('success', 'Downloaded', filename);
      
    } catch (error) {
      console.error('Audio extraction failed:', error);
      VE.showToast('error', 'Download Failed', error.message || 'Could not extract audio');
    }
  };

  VE.renderTimelineRuler = function(timelineWidth) {
    const elements = VE.elements;
    elements.timelineRuler.innerHTML = '';
    
    // Set ruler width to match timeline exactly (enables proper scrolling)
    elements.timelineRuler.style.width = `${timelineWidth}px`;
    elements.timelineRuler.style.minWidth = `${timelineWidth}px`;
    elements.timelineRuler.style.height = '30px';
    elements.timelineRuler.style.borderBottom = '1px solid var(--v2-border)';
    // Position is set to sticky in CSS to keep ruler visible while scrolling vertically
    elements.timelineRuler.style.padding = '0';
    elements.timelineRuler.style.overflow = 'hidden';
    
    const zoomLevel = VE.state.zoomLevel;
    // Use safe zoom level for calculations to prevent division by zero
    const safeZoomLevel = typeof VE.getZoomForCalculations === 'function' 
      ? VE.getZoomForCalculations() 
      : Math.max(zoomLevel, 0.1);
    
    // Professional ruler: major marks with labels, minor marks without
    // Calculate intervals based on zoom level - ensure labels have enough space (~60px minimum)
    const pixelsPerLabel = 80; // Minimum pixels between labels
    const secondsPerPixel = 1 / safeZoomLevel;
    const minSecondsPerLabel = pixelsPerLabel * secondsPerPixel;
    
    // Round to nice intervals: 1, 2, 5, 10, 15, 30, 60, 120, 300...
    const niceIntervals = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    let majorInterval = niceIntervals.find(i => i >= minSecondsPerLabel) || 600;
    
    // Minor interval is 1/5 of major (or 1 second minimum)
    let minorInterval = Math.max(1, majorInterval / 5);
    
    // Calculate max time from timeline width
    const maxTime = timelineWidth / safeZoomLevel;
    
    // Helper function to format time cleanly
    const formatRulerTime = (seconds) => {
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      if (mins === 0) {
        return `${secs}s`;
      }
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    };
    
    // Render minor marks first (no labels, short ticks)
    for (let time = 0; time <= maxTime; time += minorInterval) {
      // Skip if this is a major mark position
      if (time % majorInterval === 0) continue;
      
      const pixelPosition = time * zoomLevel;
      
      const markDiv = document.createElement('div');
      markDiv.style.position = 'absolute';
      markDiv.style.left = `${pixelPosition}px`;
      markDiv.style.bottom = '0';
      markDiv.style.height = '8px';
      markDiv.style.borderLeft = '1px solid var(--v2-border-light, rgba(255,255,255,0.15))';
      
      elements.timelineRuler.appendChild(markDiv);
    }
    
    // Render major marks (with labels, taller ticks)
    for (let time = 0; time <= maxTime; time += majorInterval) {
      const pixelPosition = time * zoomLevel;
      
      const markDiv = document.createElement('div');
      markDiv.style.position = 'absolute';
      markDiv.style.left = `${pixelPosition}px`;
      markDiv.style.bottom = '0';
      markDiv.style.height = '14px';
      markDiv.style.borderLeft = time === 0 ? 'none' : '1px solid var(--v2-border)';
      
      // Time label
      const timeSpan = document.createElement('span');
      timeSpan.style.position = 'absolute';
      timeSpan.style.bottom = '14px';
      timeSpan.style.left = time === 0 ? '4px' : '-20px';
      timeSpan.style.width = '40px';
      timeSpan.style.textAlign = time === 0 ? 'left' : 'center';
      timeSpan.style.fontSize = '10px';
      timeSpan.style.fontFamily = 'monospace';
      timeSpan.style.color = 'var(--v2-text-secondary)';
      timeSpan.style.whiteSpace = 'nowrap';
      timeSpan.textContent = formatRulerTime(time);
      
      markDiv.appendChild(timeSpan);
      elements.timelineRuler.appendChild(markDiv);
    }
  };

  // ============================================
  // Playhead Functions
  // ============================================
  VE.setPlayheadPosition = function(timeInSeconds) {
    if (VE.elements.playhead) {
      VE.elements.playhead.style.left = `${timeInSeconds * VE.state.zoomLevel}px`;
    }
  };

  VE.updatePlayheadPosition = function() {
    VE.setPlayheadPosition(VE.state.currentTime);
  };

  VE.highlightTimelineSegment = function(index) {
    const videoTrackArea = VE.elements.timelineTracks.querySelector('.video-track-area');
    if (videoTrackArea) {
      const segments = videoTrackArea.querySelectorAll('.timeline-segment');
      segments.forEach((seg, i) => {
        seg.classList.toggle('playing', i === index);
      });
    }
  };

  // ============================================
  // Zoom Functions
  // ============================================
  VE.setZoom = function(value) {
    const zMin = VE.TIMELINE_ZOOM_MIN != null ? VE.TIMELINE_ZOOM_MIN : 1;
    const zMax = VE.TIMELINE_ZOOM_MAX != null ? VE.TIMELINE_ZOOM_MAX : 48;
    VE.state.zoomLevel = Math.max(zMin, Math.min(zMax, value));
    VE.elements.zoomSlider.value = VE.state.zoomLevel;
    VE.renderTimeline();
    // Auto-save progress
    if (typeof VE.scheduleProgressSave === 'function') {
      VE.scheduleProgressSave();
    }
  };

  // ============================================
  // Split Function
  // ============================================
  VE.splitAtPlayhead = function() {
    // Try to split both video and audio at playhead
    const videoSplitResult = VE.splitVideoAtPlayhead();
    const audioSplitResult = VE.splitAudioAtPlayhead();
    
    // Show message if neither could be split
    if (!videoSplitResult && !audioSplitResult) {
      VE.showToast('warning', 'No Clip', 'Position playhead over a clip to split');
    }
  };

  VE.splitVideoAtPlayhead = function() {
    if (VE.state.timeline.length === 0) {
      return false;
    }

    // Find which segment the playhead is on
    const { segmentIndex, segmentTime } = VE.getSegmentAtTime(VE.state.currentTime);
    
    if (segmentIndex === -1) {
      return false;
    }

    const segment = VE.state.timeline[segmentIndex];
    const segmentDuration = segment.endOffset - segment.startOffset;
    
    // Don't split if too close to edges (within 0.5 seconds)
    if (segmentTime < 0.5 || segmentTime > segmentDuration - 0.5) {
      return false; // Return false so we can still try audio
    }

    // Calculate split point - use exact time, FFmpeg handles frame alignment during export
    // Round to 3 decimal places (millisecond precision) to avoid floating-point issues
    const splitPoint = Math.round((segment.startOffset + segmentTime) * 1000) / 1000;
    
    const firstPart = {
      ...segment,
      id: VE.generateId(),
      endOffset: splitPoint,
      name: segment.name + ' (1)'
    };
    
    // Clear frame cache for new segments (will be regenerated on render)
    if (firstPart.type === 'video') {
      firstPart._frameCache = null;
      firstPart._frameCacheKey = null;
    }

    const secondPart = {
      ...segment,
      id: VE.generateId(),
      startOffset: splitPoint,
      name: segment.name + ' (2)',
      colorIndex: (segment.colorIndex + 1) % VE.clipColors.length
    };
    
    // Clear frame cache for new segments (will be regenerated on render)
    if (secondPart.type === 'video') {
      secondPart._frameCache = null;
      secondPart._frameCacheKey = null;
    }

    // Replace the original segment with the two parts
    VE.state.timeline.splice(segmentIndex, 1, firstPart, secondPart);
    
    VE.updateTotalDuration();
    VE.renderTimeline();
    VE.showToast('success', 'Video Split', 'Video clip was split at playhead position');
    // Auto-save progress
    if (typeof VE.scheduleProgressSave === 'function') {
      VE.scheduleProgressSave();
    }
    return true;
  };

  VE.splitAudioAtPlayhead = function() {
    const currentTime = VE.state.currentTime;
    let splitOccurred = false;
    
    // Check both audio timelines
    const allAudioSegments = [
      ...VE.state.detachedAudioTimeline.map(s => ({ ...s, trackType: 'detached' })),
      ...VE.state.customAudioTimeline.map(s => ({ ...s, trackType: 'custom' }))
    ];
    
    // Find audio segment at current playhead position
    for (const segment of allAudioSegments) {
      const segmentStart = segment.timelineStart;
      const segmentEnd = segmentStart + (segment.endOffset - segment.startOffset);
      
      if (currentTime > segmentStart && currentTime < segmentEnd) {
        const timeIntoSegment = currentTime - segmentStart;
        const segmentDuration = segment.endOffset - segment.startOffset;
        
        // Don't split if too close to edges
        if (timeIntoSegment < 0.5 || timeIntoSegment > segmentDuration - 0.5) {
          continue; // Try next segment instead of returning
        }
        
        // Get the timeline array
        const timeline = segment.trackType === 'detached' 
          ? VE.state.detachedAudioTimeline 
          : VE.state.customAudioTimeline;
        
        const segIndex = timeline.findIndex(s => s.id === segment.id);
        if (segIndex === -1) continue;
        
        const originalSegment = timeline[segIndex];
        
        // Calculate split point - use exact time with millisecond precision
        const splitPoint = Math.round((originalSegment.startOffset + timeIntoSegment) * 1000) / 1000;
        const timelinePosition = Math.round(currentTime * 1000) / 1000;
        
        // Create two new segments
        const firstPart = {
          ...originalSegment,
          id: VE.generateId(),
          endOffset: splitPoint,
          name: originalSegment.name + ' (1)'
        };
        
        const secondPart = {
          ...originalSegment,
          id: VE.generateId(),
          startOffset: splitPoint,
          timelineStart: timelinePosition,
          name: originalSegment.name + ' (2)',
          colorIndex: (originalSegment.colorIndex + 1) % VE.audioColors.length
        };
        
        // Replace the original segment with the two parts
        timeline.splice(segIndex, 1, firstPart, secondPart);
        
        VE.updateAudioDuration();
        VE.renderTimeline();
        VE.showToast('success', 'Audio Split', 'Audio clip was split at playhead position');
        // Auto-save progress
        if (typeof VE.scheduleProgressSave === 'function') {
          VE.scheduleProgressSave();
        }
        splitOccurred = true;
        break; // Only split one audio segment at a time
      }
    }
    
    return splitOccurred;
  };

  // Expose dragState for event listeners
  VE._dragState = dragState;
  VE._removeDropIndicators = removeDropIndicators;

})();

