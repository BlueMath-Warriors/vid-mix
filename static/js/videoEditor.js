/**
 * Video Lab Editor - Main Entry Point
 * Loads all modules and initializes the editor
 */

(function() {
  'use strict';

  // Wait for all modules to load
  const VE = window.VideoEditor = window.VideoEditor || {};

  // ============================================
  // Keyboard Shortcuts
  // ============================================
  function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          VE.togglePlay();
          break;
        case 's':
        case 'S':
          if (e.ctrlKey || e.metaKey) return;
          VE.splitAtPlayhead();
          break;
        case 't':
        case 'T':
          if (e.ctrlKey || e.metaKey) return;
          VE.openTextModal();
          break;
        case 'c':
        case 'C':
          if (e.ctrlKey || e.metaKey) return;
          if (VE.state.selectedSegment) {
            VE.openClipTransformModal(VE.state.selectedSegment);
          }
          break;
        case 'f':
        case 'F': {
          if (e.ctrlKey || e.metaKey) return;
          // Toggle filters panel
          VE.elements.toolBtns.forEach(b => b.classList.remove('active'));
          const filtersBtn = document.querySelector('[data-tool="filters"]');
          if (filtersBtn) {
            filtersBtn.classList.add('active');
            VE.showPanel('filters');
          }
          break;
        }
        case 'm':
        case 'M':
          if (e.ctrlKey || e.metaKey) return;
          // Toggle audio track mute (both tracks)
          if (typeof VE.toggleAudioTrackMute === 'function') {
            VE.toggleAudioTrackMute('detached');
            VE.toggleAudioTrackMute('custom');
          }
          break;
        case 'd':
        case 'D':
          if (e.ctrlKey || e.metaKey) return;
          // Detach audio from selected video clip
          if (typeof VE.detachAudioFromSelected === 'function') {
            VE.detachAudioFromSelected();
          }
          break;
        case '-':
        case '_':
          VE.setZoom(VE.state.zoomLevel - 5);
          break;
        case '=':
        case '+':
          VE.setZoom(VE.state.zoomLevel + 5);
          break;
        case 'Delete':
        case 'Backspace':
          if (VE.state.selectedSegment) {
            e.preventDefault();
            VE.removeSelectedSegment();
          } else if (VE.state.selectedAudioSegment) {
            e.preventDefault();
            VE.removeSelectedAudioSegment();
          }
          break;
        case 'ArrowLeft':
          if (VE.elements.previewVideo.src) {
            VE.elements.previewVideo.currentTime -= 1/30;
          }
          break;
        case 'ArrowRight':
          if (VE.elements.previewVideo.src) {
            VE.elements.previewVideo.currentTime += 1/30;
          }
          break;
      }
    });
  }

  // ============================================
  // Event Listeners
  // ============================================
  function setupEventListeners() {
    const elements = VE.elements;
    
    // Transport
    elements.playBtn.addEventListener('click', VE.togglePlay);
    elements.skipStartBtn.addEventListener('click', () => {
      if (VE.state.isPlaying) VE.stopTimelinePlayback();
      VE.seekTimeline(0);
    });
    elements.skipEndBtn.addEventListener('click', () => {
      if (VE.state.isPlaying) VE.stopTimelinePlayback();
      VE.seekTimeline(VE.state.totalDuration);
    });

    // Speed control - REMOVED

    // Video events
    elements.previewVideo.addEventListener('timeupdate', () => {
      // Only update from video if not in timeline playback mode
      if (!VE.state.timelinePlaybackMode && VE.state.timeline.length === 0) {
        VE.state.currentTime = elements.previewVideo.currentTime;
        VE.updateTimeDisplay();
      }
    });

    elements.previewVideo.addEventListener('ended', () => {
      if (!VE.state.timelinePlaybackMode) {
        VE.state.isPlaying = false;
        elements.playBtn.innerHTML = '<i class="fas fa-play"></i>';
      }
    });

    // Zoom
    elements.zoomSlider.addEventListener('input', () => {
      VE.setZoom(parseInt(elements.zoomSlider.value));
    });
    elements.zoomInBtn.addEventListener('click', () => VE.setZoom(VE.state.zoomLevel + 10));
    elements.zoomOutBtn.addEventListener('click', () => VE.setZoom(VE.state.zoomLevel - 10));

    // Tool buttons
    elements.toolBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const tool = btn.dataset.tool;
        
        if (tool === 'text') {
          elements.toolBtns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          VE.openTextModal();
        } else if (tool === 'image') {
          elements.toolBtns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          VE.openImageModal();
        } else if (tool === 'media') {
          // Toggle assets popup
          if (elements.assetsPopup && elements.assetsPopup.classList.contains('active')) {
            VE.closeAssetsPopup();
            btn.classList.remove('active');
          } else {
            elements.toolBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            VE.showPanel('media');
          }
        } else if (tool === 'filters') {
          // Toggle filters popup
          if (elements.filtersPopup && elements.filtersPopup.classList.contains('active')) {
            VE.closeFiltersPopup();
            btn.classList.remove('active');
          } else {
            elements.toolBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            VE.showPanel('filters');
          }
        }
      });
    });
    
    // Assets popup close button
    if (elements.assetsPopupClose) {
      elements.assetsPopupClose.addEventListener('click', () => {
        VE.closeAssetsPopup();
        elements.toolBtns.forEach(b => b.classList.remove('active'));
      });
    }
    
    // Filters popup close button
    if (elements.filtersPopupClose) {
      elements.filtersPopupClose.addEventListener('click', () => {
        VE.closeFiltersPopup();
        elements.toolBtns.forEach(b => b.classList.remove('active'));
      });
    }
    
    // Close popups when clicking outside
    if (elements.assetsPopup) {
      elements.assetsPopup.addEventListener('click', (e) => {
        if (e.target === elements.assetsPopup) {
          VE.closeAssetsPopup();
          elements.toolBtns.forEach(b => b.classList.remove('active'));
        }
      });
    }
    
    if (elements.filtersPopup) {
      elements.filtersPopup.addEventListener('click', (e) => {
        if (e.target === elements.filtersPopup) {
          VE.closeFiltersPopup();
          elements.toolBtns.forEach(b => b.classList.remove('active'));
        }
      });
    }

    // Split tool - direct split at playhead
    if (elements.splitBtn) {
      elements.splitBtn.addEventListener('click', VE.splitAtPlayhead);
    }

    // Delete selected clip button (works for both video and audio segments)
    if (elements.deleteClipBtn) {
      elements.deleteClipBtn.addEventListener('click', () => {
        if (VE.state.selectedSegment) {
          VE.removeSelectedSegment();
        } else if (VE.state.selectedAudioSegment) {
          VE.removeSelectedAudioSegment();
        } else {
          VE.showToast('info', 'No Selection', 'Select a clip to delete');
        }
      });
    }
    
    // Crop button
    if (elements.cropBtn) {
      elements.cropBtn.addEventListener('click', () => {
        if (VE.state.selectedSegment) {
          VE.openClipTransformModal(VE.state.selectedSegment);
        } else {
          VE.showToast('info', 'No Selection', 'Select a clip to edit');
        }
      });
    }
    
    // Detach Audio button
    const detachAudioBtn = document.getElementById('detach-audio-btn');
    if (detachAudioBtn) {
      detachAudioBtn.addEventListener('click', () => {
        VE.detachAudioFromSelected();
      });
    }
    
    // Download clip button
    if (elements.downloadClipBtn) {
      elements.downloadClipBtn.addEventListener('click', () => {
        VE.downloadSelectedClip();
      });
    }
    
    // Crop/Transform modal events
    if (elements.cropModal) {
      elements.closeCropModal.addEventListener('click', VE.closeCropModal);
      elements.cancelCropBtn.addEventListener('click', VE.closeCropModal);
      elements.applyCropBtn.addEventListener('click', VE.applyClipTransform);
      elements.resetCropBtn.addEventListener('click', VE.resetClipTransform);
      
      elements.cropModal.addEventListener('click', (e) => {
        if (e.target === elements.cropModal) VE.closeCropModal();
      });
      
      // Preset buttons
      elements.presetBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          VE.setAspectRatioPreset(btn.dataset.ratio);
        });
      });
      
      // Setup drag handlers
      VE.setupCropDragHandlers();
      
      // Update crop box on window resize
      window.addEventListener('resize', () => {
        if (elements.cropModal.classList.contains('show')) {
          VE.updateCropBoxVisual();
        }
      });
    }

    // Export
    elements.exportBtn.addEventListener('click', VE.openExportModal);
    elements.closeExportModal.addEventListener('click', VE.closeExportModal);
    elements.cancelExportBtn.addEventListener('click', VE.closeExportModal);
    elements.startExportBtn.addEventListener('click', VE.startExport);
    elements.exportModal.addEventListener('click', (e) => {
      if (e.target === elements.exportModal) VE.closeExportModal();
    });

    // Text modal
    elements.closeTextModal.addEventListener('click', VE.closeTextModal);
    elements.cancelTextBtn.addEventListener('click', VE.closeTextModal);
    elements.addTextBtn.addEventListener('click', VE.addTextFrameToTimeline);
    elements.textModal.addEventListener('click', (e) => {
      if (e.target === elements.textModal) VE.closeTextModal();
    });
    
    elements.textContent.addEventListener('input', VE.updateTextPreview);
    elements.textFont.addEventListener('change', VE.updateTextPreview);
    elements.textSize.addEventListener('change', VE.updateTextPreview);
    elements.textColor.addEventListener('input', VE.updateTextPreview);
    elements.bgColor.addEventListener('input', VE.updateTextPreview);

    // Image modal
    elements.closeImageModal.addEventListener('click', VE.closeImageModal);
    elements.cancelImageBtn.addEventListener('click', VE.closeImageModal);
    elements.addImageBtn.addEventListener('click', VE.addImageFrameToTimeline);
    elements.imageModal.addEventListener('click', (e) => {
      if (e.target === elements.imageModal) VE.closeImageModal();
    });
    if (elements.imageDuration) {
      elements.imageDuration.addEventListener('input', () => {
        // Duration change doesn't need preview update for images
      });
    }

    // Timeline click to seek - works on both empty space and ruler
    elements.timelineTracks.addEventListener('click', (e) => {
      // Don't seek when clicking on segments or audio segments
      if (e.target.closest('.timeline-segment') || e.target.closest('.audio-segment')) return;
      
      const timelineContentColumn = elements.timelineTracks.closest('.timeline-content-column');
      const scrollLeft = timelineContentColumn ? timelineContentColumn.scrollLeft : 0;
      const rect = elements.timelineTracks.getBoundingClientRect();
      const x = e.clientX - rect.left + scrollLeft;
      const time = Math.max(0, x / VE.getZoomForCalculations());
      
      if (VE.state.isPlaying) VE.stopTimelinePlayback();
      VE.seekTimeline(time);
    });

    // Timeline tracks drag-and-drop for reordering
    elements.timelineTracks.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      
      // Only show end indicator if not over a segment
      if (!e.target.closest('.timeline-segment') && VE._dragState.isDragging) {
        const videoTrackArea = elements.timelineTracks.querySelector('.video-track-area');
        if (!videoTrackArea) return;
        
        // Find the closest segment to determine insertion point
        const timelineContentColumn = elements.timelineTracks.closest('.timeline-content-column');
        const scrollLeft = timelineContentColumn ? timelineContentColumn.scrollLeft : 0;
        const rect = videoTrackArea.getBoundingClientRect();
        const x = e.clientX - rect.left + scrollLeft;
        
        // Check if dropping at the end
        const lastSegment = videoTrackArea.querySelector('.timeline-segment:last-of-type');
        if (lastSegment) {
          const lastRect = {
            left: parseFloat(lastSegment.style.left) || 0,
            width: parseFloat(lastSegment.style.width) || 0
          };
          const lastSegmentEnd = lastRect.left + lastRect.width;
          
          if (x > lastSegmentEnd + 20) {
            // Show indicator at the end
            VE._removeDropIndicators();
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
            indicator.style.left = `${lastSegmentEnd + 8}px`;
            videoTrackArea.appendChild(indicator);
            VE._dragState.dropTargetIndex = VE.state.timeline.length;
          }
        }
      }
    });

    elements.timelineTracks.addEventListener('drop', (e) => {
      // Only handle if not dropping on a segment
      if (e.target.closest('.timeline-segment')) return;
      
      e.preventDefault();
      
      const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
      if (isNaN(fromIndex)) {
        VE._removeDropIndicators();
        return;
      }
      
      // Move to end
      if (VE._dragState.dropTargetIndex === VE.state.timeline.length) {
        const toIndex = VE.state.timeline.length - 1;
        if (fromIndex !== toIndex) {
          VE.reorderTimeline(fromIndex, toIndex);
        }
      }
      
      VE._removeDropIndicators();
    });

    // Ruler click to seek
    elements.timelineRuler.addEventListener('click', (e) => {
      const timelineContentColumn = elements.timelineRuler.closest('.timeline-content-column');
      const scrollLeft = timelineContentColumn ? timelineContentColumn.scrollLeft : 0;
      const rect = elements.timelineRuler.getBoundingClientRect();
      const x = e.clientX - rect.left + scrollLeft;
      const time = Math.max(0, x / VE.getZoomForCalculations());
      
      if (VE.state.isPlaying) VE.stopTimelinePlayback();
      VE.seekTimeline(time);
    });

    // Synchronize horizontal scrolling between ruler and tracks
    // Since both are now children of timeline-content-column, they scroll together automatically
    // But we ensure the scroll container is properly set up
    const timelineContentColumn = elements.timelineRuler?.closest('.timeline-content-column');
    if (timelineContentColumn) {
      // Ensure smooth scrolling
      timelineContentColumn.style.scrollBehavior = 'smooth';
    }

    // Playhead drag
    setupPlayheadDrag();

  }

  function setupPlayheadDrag() {
    let isDragging = false;
    const elements = VE.elements;
    
    // Make playhead draggable
    elements.playhead.style.pointerEvents = 'auto';
    elements.playhead.style.cursor = 'ew-resize';
    
    elements.playhead.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      isDragging = true;
      if (VE.state.isPlaying) VE.stopTimelinePlayback();
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
    });

    // Playhead drag handler - throttled for smooth 60fps updates
    const handlePlayheadDrag = (e) => {
      if (!isDragging) return;
      
      const timelineContentColumn = elements.timelineTracks.closest('.timeline-content-column');
      const scrollLeft = timelineContentColumn ? timelineContentColumn.scrollLeft : 0;
      const rect = elements.timelineTracks.getBoundingClientRect();
      const x = e.clientX - rect.left + scrollLeft;
      const time = Math.max(0, Math.min(x / VE.getZoomForCalculations(), VE.state.totalDuration));
      
      VE.state.currentTime = time;
      VE.setPlayheadPosition(time);
      VE.updateTimeDisplay();
    };
    
    document.addEventListener('mousemove', VE.throttle(handlePlayheadDrag, 16));

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        
        // Update the video preview to the new position
        if (VE.state.timeline.length > 0) {
          VE.seekTimeline(VE.state.currentTime);
        }
      }
    });
  }

  // ============================================
  // Initialization
  // ============================================
  function init() {
    // Initialize elements FIRST - required by all other modules
    VE.initElements();
    
    // Initialize projects - this loads project data from URL
    if (typeof VE.initProjects === 'function') {
      VE.initProjects();
    }
    
    VE.setupUploadHandlers();
    VE.setupLibraryTabHandlers();
    setupEventListeners();
    setupKeyboardShortcuts();
    VE.setupFilterEventListeners();
    VE.setupResolutionEventListeners();
    VE.setupTransformEventListeners();
    VE.initCompositionCanvas();
    VE.renderTimeline();
    
    // Initialize filters
    VE.updateFilterSliders();
    VE.applyFilters();
    
    // Initialize project resolution UI
    VE.updateCanvasAspectRatio(VE.state.projectResolution.width, VE.state.projectResolution.height);
    if (VE.elements.resolutionIndicatorText) {
      VE.elements.resolutionIndicatorText.textContent = `${VE.state.projectResolution.width} × ${VE.state.projectResolution.height}`;
    }
    
    // Initialize export resolution to match project
    VE.state.exportResolution = {
      preset: 'project',
      width: VE.state.projectResolution.width,
      height: VE.state.projectResolution.height
    };
    
    console.log('Video Lab Editor initialized');

    fetch('/api/health')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data && data.ffmpeg_wasm === false) {
          const banner = document.getElementById('ffmpeg-wasm-banner');
          if (banner) {
            banner.style.display = 'flex';
          }
        }
      })
      .catch(function() { /* ignore */ });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
