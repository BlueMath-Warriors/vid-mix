/**
 * Video Lab Editor - Utility Functions
 * Common utilities used across modules
 */

(function() {
  'use strict';
  
  const VE = window.VideoEditor = window.VideoEditor || {};

  // ============================================
  // DOM Elements Cache
  // ============================================
  VE.elements = {};
  
  VE.initElements = function() {
    const elements = VE.elements;
    
    // Preview
    elements.previewVideo = document.getElementById('preview-video');
    elements.textFrameCanvas = document.getElementById('text-frame-canvas');
    elements.imageFrameCanvas = document.getElementById('image-frame-canvas');
    elements.canvasPlaceholder = document.getElementById('canvas-placeholder');
    elements.videoCanvas = document.getElementById('video-canvas');
    
    // Transport
    elements.playBtn = document.getElementById('play-btn');
    elements.skipStartBtn = document.getElementById('skip-start-btn');
    elements.skipEndBtn = document.getElementById('skip-end-btn');
    // Speed control elements - REMOVED
    // elements.speedBtn = document.getElementById('speed-btn');
    // elements.speedLabel = document.getElementById('speed-label');
    // elements.speedDropdown = document.getElementById('speed-dropdown');
    
    // Upload
    elements.uploadZone = document.getElementById('import-dropzone');
    elements.fileInput = document.getElementById('file-input');
    elements.assetGrid = document.getElementById('asset-grid');
    
    // Timeline
    elements.timelineRuler = document.getElementById('timeline-ruler');
    elements.timelineTracks = document.getElementById('timeline-tracks');
    elements.playhead = document.getElementById('playhead');
    elements.timeDisplay = document.getElementById('time-display');
    elements.zoomSlider = document.getElementById('zoom-slider');
    elements.zoomInBtn = document.getElementById('zoom-in-btn');
    elements.zoomOutBtn = document.getElementById('zoom-out-btn');
    if (elements.zoomSlider && VE.TIMELINE_ZOOM_MIN != null && VE.TIMELINE_ZOOM_MAX != null) {
      elements.zoomSlider.min = String(VE.TIMELINE_ZOOM_MIN);
      elements.zoomSlider.max = String(VE.TIMELINE_ZOOM_MAX);
      elements.zoomSlider.value = String(VE.state.zoomLevel);
    }

    // Tools
    elements.splitBtn = document.getElementById('split-btn');
    elements.deleteClipBtn = document.getElementById('delete-clip-btn');
    elements.downloadClipBtn = document.getElementById('download-clip-btn');
    elements.toolBtns = document.querySelectorAll('[data-tool]');
    
    // Export
    elements.exportBtn = document.getElementById('export-btn');
    elements.exportModal = document.getElementById('export-modal');
    elements.exportFormat = document.getElementById('export-format');
    elements.exportResolution = document.getElementById('export-resolution');
    elements.exportProgress = document.getElementById('export-progress');
    elements.progressFill = document.getElementById('progress-fill');
    elements.progressText = document.getElementById('progress-text');
    elements.startExportBtn = document.getElementById('start-export');
    elements.cancelExportBtn = document.getElementById('cancel-export');
    elements.closeExportModal = document.getElementById('close-export-modal');
    elements.exportResolutionInfo = document.getElementById('export-resolution-info');
    elements.exportQualityContainer = document.getElementById('export-quality-container');
    elements.exportEta = document.getElementById('export-eta');
    
    // Text Modal
    elements.textModal = document.getElementById('text-modal');
    elements.closeTextModal = document.getElementById('close-text-modal');
    elements.textContent = document.getElementById('text-content');
    elements.textFont = document.getElementById('text-font');
    elements.textSize = document.getElementById('text-size');
    elements.textColor = document.getElementById('text-color');
    elements.bgColor = document.getElementById('bg-color');
    elements.textDuration = document.getElementById('text-duration');
    elements.textPreview = document.getElementById('text-preview');
    elements.addTextBtn = document.getElementById('add-text-btn');
    elements.cancelTextBtn = document.getElementById('cancel-text');
    
    // Image Modal
    elements.imageModal = document.getElementById('image-modal');
    elements.closeImageModal = document.getElementById('close-image-modal');
    elements.imageAssetsGrid = document.getElementById('image-assets-grid');
    elements.imageAssetsEmpty = document.getElementById('image-assets-empty');
    elements.imageDuration = document.getElementById('image-duration');
    elements.imagePreview = document.getElementById('image-preview');
    elements.addImageBtn = document.getElementById('add-image-btn');
    elements.cancelImageBtn = document.getElementById('cancel-image');
    
    // Project
    elements.projectTitle = document.getElementById('project-title');
    
    // Toast
    elements.toastContainer = document.getElementById('toast-container');
    
    // Project Resolution
    elements.resolutionBtn = document.getElementById('resolution-btn');
    elements.resolutionLabel = document.getElementById('resolution-label');
    elements.resolutionDropdown = document.getElementById('resolution-dropdown');
    elements.resolutionOptions = document.querySelectorAll('.resolution-option');
    elements.resolutionIndicator = document.getElementById('resolution-indicator');
    elements.resolutionIndicatorText = document.getElementById('resolution-indicator-text');
    elements.videoCanvasContainer = document.getElementById('video-canvas-container');
    elements.compositionCanvas = document.getElementById('composition-canvas');
    
    // Crop/Transform Modal
    elements.cropModal = document.getElementById('crop-modal');
    elements.closeCropModal = document.getElementById('close-crop-modal');
    elements.cropPreviewVideo = document.getElementById('crop-preview-video');
    elements.cropPreviewWrapper = document.getElementById('crop-preview-wrapper');
    elements.cropBox = document.getElementById('crop-box');
    elements.cropOverlay = document.getElementById('crop-overlay');
    elements.resetCropBtn = document.getElementById('reset-crop-btn');
    elements.applyCropBtn = document.getElementById('apply-crop-btn');
    elements.cancelCropBtn = document.getElementById('cancel-crop');
    elements.cropBtn = document.getElementById('crop-btn');
    elements.presetBtns = document.querySelectorAll('.crop-presets .preset-btn');
    
    // Transform Modal - Position Controls
    elements.projectResHint = document.getElementById('project-res-hint');
    elements.canvasFrame = document.getElementById('canvas-frame');
    elements.clipPreviewBox = document.getElementById('clip-preview-box');
    elements.positionPreviewVideo = document.getElementById('position-preview-video');
    elements.clipPosX = document.getElementById('clip-pos-x');
    elements.clipPosY = document.getElementById('clip-pos-y');
    elements.clipScale = document.getElementById('clip-scale');
    elements.clipScaleSlider = document.getElementById('clip-scale-slider');
    elements.positionPresetBtns = document.querySelectorAll('.position-preset-btn');
    elements.fitCanvasBtn = document.getElementById('fit-canvas-btn');
    
    // Filters
    elements.filtersPanel = document.getElementById('filters-popup');
    elements.mediaPanel = document.getElementById('assets-popup');
    elements.assetsPopup = document.getElementById('assets-popup');
    elements.assetsPopupClose = document.getElementById('assets-popup-close');
    elements.filtersPopup = document.getElementById('filters-popup');
    elements.filtersPopupClose = document.getElementById('filters-popup-close');
    elements.filterPresetBtns = document.querySelectorAll('.filter-preset-btn');
    elements.resetFiltersBtn = document.getElementById('reset-filters-btn');
    elements.vignetteOverlay = document.getElementById('vignette-overlay');
    elements.filterBadge = document.getElementById('filter-badge');
    elements.filterBadgeText = document.getElementById('filter-badge-text');
  };

  // ============================================
  // Time Formatting
  // ============================================
  VE.formatTime = function(seconds) {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
  };

  VE.formatTimeShort = function(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    if (mins > 0) {
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
    return `${secs}s`;
  };

  // Format timecode as HH:MM:SS:FF (frames)
  VE.formatTimeCode = function(seconds, fps = 30) {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const frames = Math.floor((seconds % 1) * fps);
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`;
  };

  // ============================================
  // ID Generation
  // ============================================
  VE.generateId = function() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  };

  // ============================================
  // Performance Utilities
  // ============================================
  
  /**
   * Throttle function - limits how often a function can be called
   * @param {Function} fn - Function to throttle
   * @param {number} ms - Minimum milliseconds between calls (default 16ms = ~60fps)
   */
  VE.throttle = function(fn, ms = 16) {
    let lastCall = 0;
    let scheduledCall = null;
    return function(...args) {
      const now = performance.now();
      const timeSinceLastCall = now - lastCall;
      
      if (timeSinceLastCall >= ms) {
        lastCall = now;
        fn.apply(this, args);
      } else if (!scheduledCall) {
        // Schedule a final call to ensure we don't miss the last position
        scheduledCall = setTimeout(() => {
          lastCall = performance.now();
          scheduledCall = null;
          fn.apply(this, args);
        }, ms - timeSinceLastCall);
      }
    };
  };

  /**
   * Debounce function - delays execution until after wait period of inactivity
   * @param {Function} fn - Function to debounce
   * @param {number} ms - Milliseconds to wait
   */
  VE.debounce = function(fn, ms = 100) {
    let timeoutId = null;
    return function(...args) {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => fn.apply(this, args), ms);
    };
  };

  // Use this when dividing by zoomLevel to avoid divide-by-zero issues
  VE.getZoomForCalculations = function() {
    return Math.max(VE.state.zoomLevel, 0.1);
  };

  // ============================================
  // Toast Notifications
  // ============================================
  VE.showToast = function(type, title, message) {
    // Get toast container - use cached element or query DOM directly
    const container = VE.elements?.toastContainer || document.getElementById('toast-container');
    if (!container) {
      console.warn('Toast container not found:', type, title, message);
      return;
    }
    
    const icons = {
      success: 'fa-check-circle',
      error: 'fa-exclamation-circle',
      warning: 'fa-exclamation-triangle',
      info: 'fa-info-circle'
    };

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <i class="fas ${icons[type]}"></i>
      <div class="toast-content">
        <div class="toast-title">${title}</div>
        ${message ? `<div class="toast-message">${message}</div>` : ''}
      </div>
    `;

    container.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'slideIn 0.3s ease reverse';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  };

  // ============================================
  // String Utilities
  // ============================================
  VE.capitalizeFirst = function(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  };

  // ============================================
  // Panel Management (now using popups)
  // ============================================
  VE.showPanel = function(panelName) {
    const elements = VE.elements;
    
    // Hide all popups
    if (elements.assetsPopup) elements.assetsPopup.classList.remove('active');
    if (elements.filtersPopup) elements.filtersPopup.classList.remove('active');
    
    // Show selected popup
    if (panelName === 'media' && elements.assetsPopup) {
      elements.assetsPopup.classList.add('active');
      // Ensure upload zone is visible if no assets
      if (elements.uploadZone && (!elements.assetGrid || !elements.assetGrid.classList.contains('visible'))) {
        elements.uploadZone.style.display = 'flex';
      }
    } else if (panelName === 'filters' && elements.filtersPopup) {
      elements.filtersPopup.classList.add('active');
    }
  };
  
  VE.closeAssetsPopup = function() {
    if (VE.elements.assetsPopup) {
      VE.elements.assetsPopup.classList.remove('active');
    }
  };
  
  VE.closeFiltersPopup = function() {
    if (VE.elements.filtersPopup) {
      VE.elements.filtersPopup.classList.remove('active');
    }
  };

})();





