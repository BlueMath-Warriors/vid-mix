/**
 * Video Lab Editor - Filters Module
 * Filter presets, filter application, composition canvas
 */

(function() {
  'use strict';
  
  const VE = window.VideoEditor = window.VideoEditor || {};

  // ============================================
  // Composition Canvas State
  // ============================================
  let compositionCtx = null;
  let compositionAnimationId = null;

  // ============================================
  // Filter Functions
  // ============================================
  VE.applyFilters = function() {
    const { brightness, contrast, saturation, hue, blur, vignette } = VE.state.filters;
    
    // Build CSS filter string
    const filterString = [
      `brightness(${brightness}%)`,
      `contrast(${contrast}%)`,
      `saturate(${saturation}%)`,
      `hue-rotate(${hue}deg)`,
      blur > 0 ? `blur(${blur}px)` : ''
    ].filter(Boolean).join(' ');
    
    // Apply to video and text canvas
    VE.elements.previewVideo.style.filter = filterString;
    VE.elements.textFrameCanvas.style.filter = filterString;
    VE.elements.imageFrameCanvas.style.filter = filterString;
    
    // Also apply to crop render canvas if it exists
    const cropCanvas = VE.elements.videoCanvas.querySelector('canvas.crop-render-canvas');
    if (cropCanvas) {
      cropCanvas.style.filter = filterString;
    }
    
    // Apply vignette effect
    applyVignette(vignette);
    
    // Update filter badge
    updateFilterBadge();
  };

  function applyVignette(intensity) {
    if (!VE.elements.vignetteOverlay) return;
    
    if (intensity > 0) {
      const spread = 100 - (intensity * 0.7);
      VE.elements.vignetteOverlay.style.boxShadow = `inset 0 0 ${spread}px ${intensity}px rgba(0, 0, 0, ${intensity / 100})`;
    } else {
      VE.elements.vignetteOverlay.style.boxShadow = 'none';
    }
  }

  function updateFilterBadge() {
    if (!VE.elements.filterBadge || !VE.elements.filterBadgeText) return;
    
    const hasActiveFilter = VE.state.activeFilterPreset !== 'none' || VE.hasCustomFilters();
    
    if (hasActiveFilter) {
      VE.elements.filterBadge.classList.add('visible');
      if (VE.state.activeFilterPreset !== 'none') {
        VE.elements.filterBadgeText.textContent = VE.capitalizeFirst(VE.state.activeFilterPreset);
      } else {
        VE.elements.filterBadgeText.textContent = 'Custom';
      }
    } else {
      VE.elements.filterBadge.classList.remove('visible');
    }
  }

  VE.hasCustomFilters = function() {
    const defaults = VE.filterPresets.none;
    return VE.state.filters.brightness !== defaults.brightness ||
           VE.state.filters.contrast !== defaults.contrast ||
           VE.state.filters.saturation !== defaults.saturation ||
           VE.state.filters.hue !== defaults.hue ||
           VE.state.filters.blur !== defaults.blur ||
           VE.state.filters.vignette !== defaults.vignette;
  };

  VE.setFilterPreset = function(presetName) {
    if (!VE.filterPresets[presetName]) return;
    
    VE.state.activeFilterPreset = presetName;
    VE.state.filters = { ...VE.filterPresets[presetName] };
    
    // Update UI
    VE.applyFilters();
    
    // Update preset button states
    VE.elements.filterPresetBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.preset === presetName);
    });
    
    if (presetName !== 'none') {
      VE.showToast('info', 'Filter Applied', VE.capitalizeFirst(presetName));
    }
    // Auto-save progress
    if (typeof VE.scheduleProgressSave === 'function') {
      VE.scheduleProgressSave();
    }
  };

  VE.resetFilters = function() {
    VE.setFilterPreset('none');
    VE.showToast('info', 'Filters Reset', 'All filters cleared');
  };

  VE.getFilterCSSString = function() {
    const { brightness, contrast, saturation, hue, blur } = VE.state.filters;
    return [
      `brightness(${brightness}%)`,
      `contrast(${contrast}%)`,
      `saturate(${saturation}%)`,
      `hue-rotate(${hue}deg)`,
      blur > 0 ? `blur(${blur}px)` : ''
    ].filter(Boolean).join(' ');
  };

  // Get FFmpeg filter string for export
  VE.getFFmpegFilterString = function() {
    const filters = [];
    const { brightness, contrast, saturation, hue } = VE.state.filters;
    
    // FFmpeg eq filter for brightness, contrast, saturation
    const ffGamma = brightness / 100;
    const ffContrast = contrast / 100;
    const ffSaturation = saturation / 100;
    
    if (ffGamma !== 1 || ffContrast !== 1 || ffSaturation !== 1) {
      filters.push(`eq=gamma=${ffGamma.toFixed(2)}:contrast=${ffContrast.toFixed(2)}:saturation=${ffSaturation.toFixed(2)}`);
    }
    
    // Hue rotation
    if (hue !== 0) {
      filters.push(`hue=h=${hue}`);
    }
    
    // Blur (box blur)
    if (VE.state.filters.blur > 0) {
      const blurRadius = Math.max(1, Math.round(VE.state.filters.blur * 1.5));
      filters.push(`boxblur=luma_radius=${blurRadius}:luma_power=2:chroma_radius=${blurRadius}:chroma_power=2`);
    }
    
    // Vignette
    if (VE.state.filters.vignette > 0) {
      const minAngle = Math.PI / 5;
      const maxAngle = Math.PI / 2.2;
      const vignetteAngle = minAngle + (VE.state.filters.vignette / 100) * (maxAngle - minAngle);
      filters.push(`vignette=angle=${vignetteAngle.toFixed(3)}`);
    }
    
    return filters.length > 0 ? filters.join(',') : null;
  };

  VE.setupFilterEventListeners = function() {
    // Preset buttons
    if (VE.elements.filterPresetBtns) {
      VE.elements.filterPresetBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          VE.setFilterPreset(btn.dataset.preset);
        });
      });
    }
    
    // Reset button
    if (VE.elements.resetFiltersBtn) {
      VE.elements.resetFiltersBtn.addEventListener('click', VE.resetFilters);
    }
  };

  // Stub for filter sliders (not used in preset-only mode)
  VE.updateFilterSliders = function() {
    // Filter sliders were removed - using presets only
  };

  // ============================================
  // Project Resolution Functions
  // ============================================
  VE.setProjectResolution = function(preset) {
    if (!VE.resolutionPresets[preset]) return;
    
    const resolution = VE.resolutionPresets[preset];
    VE.state.projectResolution = {
      preset: preset,
      width: resolution.width,
      height: resolution.height
    };
    
    // Update UI
    if (VE.elements.resolutionLabel) {
      VE.elements.resolutionLabel.textContent = resolution.label;
    }
    
    if (VE.elements.resolutionIndicatorText) {
      VE.elements.resolutionIndicatorText.textContent = `${resolution.width} × ${resolution.height}`;
    }
    
    // Update resolution option states
    if (VE.elements.resolutionOptions) {
      VE.elements.resolutionOptions.forEach(opt => {
        opt.classList.toggle('active', opt.dataset.preset === preset);
      });
    }
    
    // Update canvas aspect ratio based on dimensions
    VE.updateCanvasAspectRatio(resolution.width, resolution.height);
    
    // Wait for CSS layout to update, then update canvas size and re-render
    requestAnimationFrame(() => {
      VE.updateCompositionCanvasSize();
      VE.renderComposition();
    });
    
    VE.showToast('info', 'Resolution Changed', `${resolution.width} × ${resolution.height}`);
    // Auto-save progress
    if (typeof VE.scheduleProgressSave === 'function') {
      VE.scheduleProgressSave();
    }
  };

  VE.updateCanvasAspectRatio = function(width, height) {
    if (!VE.elements.videoCanvas) return;
    
    // Remove all ratio classes
    VE.elements.videoCanvas.classList.remove('ratio-16-9', 'ratio-9-16', 'ratio-1-1', 'ratio-4-3', 'ratio-4-5', 'ratio-21-9');
    
    // Calculate aspect ratio and add appropriate class
    const ratio = width / height;
    let ratioClass = 'ratio-16-9'; // default
    
    if (ratio < 0.6) {
      ratioClass = 'ratio-9-16'; // Portrait (e.g., 9:16 = 0.5625)
    } else if (ratio >= 0.6 && ratio < 0.85) {
      ratioClass = 'ratio-4-5'; // Instagram portrait (4:5 = 0.8)
    } else if (ratio >= 0.85 && ratio < 1.15) {
      ratioClass = 'ratio-1-1'; // Square
    } else if (ratio >= 1.15 && ratio < 1.5) {
      ratioClass = 'ratio-4-3'; // 4:3 = 1.333
    } else if (ratio >= 1.5 && ratio < 2.0) {
      ratioClass = 'ratio-16-9'; // 16:9 = 1.777
    } else {
      ratioClass = 'ratio-21-9'; // Ultrawide (21:9 = 2.333)
    }
    
    VE.elements.videoCanvas.classList.add(ratioClass);
  };

  VE.setupResolutionEventListeners = function() {
    // Resolution dropdown toggle
    if (VE.elements.resolutionBtn && VE.elements.resolutionDropdown) {
      VE.elements.resolutionBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        VE.elements.resolutionDropdown.classList.toggle('show');
      });
      
      // Close on click outside
      document.addEventListener('click', (e) => {
        if (!VE.elements.resolutionBtn.contains(e.target) && !VE.elements.resolutionDropdown.contains(e.target)) {
          VE.elements.resolutionDropdown.classList.remove('show');
        }
      });
    }
    
    // Resolution options
    if (VE.elements.resolutionOptions) {
      VE.elements.resolutionOptions.forEach(option => {
        option.addEventListener('click', (e) => {
          e.stopPropagation();
          const preset = option.dataset.preset;
          VE.setProjectResolution(preset);
          VE.elements.resolutionDropdown.classList.remove('show');
        });
      });
    }
    
    // Export resolution selector
    if (VE.elements.exportResolution) {
      VE.elements.exportResolution.addEventListener('change', VE.updateExportResolution);
    }
  };

  VE.updateExportResolution = function() {
    const presetId = VE.elements.exportResolution.value;
    const preset = VE.exportResolutionPresets.find(p => p.id === presetId);
    
    if (preset) {
      if (presetId === 'project') {
        // Use project resolution
        VE.state.exportResolution = {
          preset: 'project',
          width: VE.state.projectResolution.width,
          height: VE.state.projectResolution.height
        };
        if (VE.elements.exportResolutionInfo) {
          VE.elements.exportResolutionInfo.textContent = `Resolution: ${VE.state.projectResolution.width} × ${VE.state.projectResolution.height} (Project)`;
        }
      } else {
        VE.state.exportResolution = {
          preset: presetId,
          width: preset.width,
          height: preset.height
        };
        if (VE.elements.exportResolutionInfo) {
          VE.elements.exportResolutionInfo.textContent = `Resolution: ${preset.width} × ${preset.height}`;
        }
      }
    }
  };

  // ============================================
  // Composition Canvas Functions
  // ============================================
  VE.initCompositionCanvas = function() {
    if (!VE.elements.compositionCanvas) return;
    
    compositionCtx = VE.elements.compositionCanvas.getContext('2d');
    
    // Set initial canvas size
    VE.updateCompositionCanvasSize();
    
    // Observe canvas container for resize
    const resizeObserver = new ResizeObserver(() => {
      VE.updateCompositionCanvasSize();
      VE.renderComposition();
    });
    
    if (VE.elements.videoCanvas) {
      resizeObserver.observe(VE.elements.videoCanvas);
    }
  };

  VE.updateCompositionCanvasSize = function() {
    if (!VE.elements.compositionCanvas || !VE.elements.videoCanvas) return;
    
    const rect = VE.elements.videoCanvas.getBoundingClientRect();
    
    // Use bounding rect if valid, otherwise calculate from project resolution
    let width, height;
    if (rect.width > 10 && rect.height > 10) {
      width = Math.round(rect.width);
      height = Math.round(rect.height);
    } else {
      // Fallback: calculate size from project resolution at a reasonable display size
      const maxWidth = 800;
      const aspectRatio = VE.state.projectResolution.width / VE.state.projectResolution.height;
      width = maxWidth;
      height = Math.round(maxWidth / aspectRatio);
    }
    
    // Only update if dimensions actually changed
    if (VE.elements.compositionCanvas.width !== width || VE.elements.compositionCanvas.height !== height) {
      VE.elements.compositionCanvas.width = width;
      VE.elements.compositionCanvas.height = height;
    }
  };

  VE.renderComposition = function() {
    if (!compositionCtx || !VE.elements.compositionCanvas) return;
    
    const canvas = VE.elements.compositionCanvas;
    const ctx = compositionCtx;
    
    // If no timeline segments, hide canvas and show video directly
    if (VE.state.timeline.length === 0) {
      canvas.style.display = 'none';
      return;
    }
    
    // Get current segment
    const { segmentIndex } = VE.getSegmentAtTime(VE.state.currentTime);
    if (segmentIndex === -1) {
      canvas.style.display = 'none';
      return;
    }
    
    const segment = VE.state.timeline[segmentIndex];
    if (!segment) {
      canvas.style.display = 'none';
      return;
    }
    
    // For video segments, check if video is ready before showing composition canvas
    if (segment.type !== 'text' && segment.type !== 'image') {
      const video = VE.elements.previewVideo;
      if (!video || video.readyState < 2) {
        canvas.style.display = 'none';
        return;
      }
    }
    
    // Show canvas and render content
    canvas.style.display = 'block';
    
    // Clear canvas
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    if (segment.type === 'text') {
      renderTextSegmentToComposition(segment, ctx, canvas);
    } else if (segment.type === 'image') {
      renderImageSegmentToComposition(segment, ctx, canvas);
    } else {
      renderVideoSegmentToComposition(segment, ctx, canvas);
    }
    
    // Apply filters to the canvas
    const filterString = VE.getFilterCSSString();
    if (filterString) {
      canvas.style.filter = filterString;
    } else {
      canvas.style.filter = '';
    }
  };

  function renderVideoSegmentToComposition(segment, ctx, canvas) {
    const video = VE.elements.previewVideo;
    if (!video || video.readyState < 2) return;
    
    const transform = segment.transform || VE.getDefaultTransform(segment);
    const crop = segment.crop;
    
    // Calculate source rectangle (what part of the video to use)
    const sourceX = crop ? crop.x : 0;
    const sourceY = crop ? crop.y : 0;
    const sourceWidth = crop ? crop.width : video.videoWidth;
    const sourceHeight = crop ? crop.height : video.videoHeight;
    
    // Calculate aspect ratios
    const sourceAspect = sourceWidth / sourceHeight;
    const canvasAspect = canvas.width / canvas.height;
    
    // Calculate base destination size to fit video within canvas (contain behavior)
    let baseWidth, baseHeight;
    if (sourceAspect > canvasAspect) {
      // Video is wider than canvas - fit to width
      baseWidth = canvas.width;
      baseHeight = canvas.width / sourceAspect;
    } else {
      // Video is taller than canvas - fit to height
      baseHeight = canvas.height;
      baseWidth = canvas.height * sourceAspect;
    }
    
    // Apply transform scale
    const scale = transform.scale / 100;
    const destWidth = baseWidth * scale;
    const destHeight = baseHeight * scale;
    
    // Calculate position - center by default, then apply transform offset
    const centerX = (canvas.width - destWidth) / 2;
    const centerY = (canvas.height - destHeight) / 2;
    
    // Transform position is relative to project resolution
    const offsetX = (transform.x / VE.state.projectResolution.width) * canvas.width;
    const offsetY = (transform.y / VE.state.projectResolution.height) * canvas.height;
    
    const destX = centerX + offsetX;
    const destY = centerY + offsetY;
    
    ctx.drawImage(
      video,
      sourceX, sourceY, sourceWidth, sourceHeight,
      destX, destY, destWidth, destHeight
    );
  }

  function renderTextSegmentToComposition(segment, ctx, canvas) {
    ctx.fillStyle = segment.bgColor || '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    ctx.fillStyle = segment.color || '#fff';
    ctx.font = `bold ${Math.round(segment.fontSize * (canvas.height / 1080))}px ${segment.font || 'DM Sans'}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    const lines = (segment.text || '').split('\n');
    const lineHeight = segment.fontSize * (canvas.height / 1080) * 1.4;
    const startY = canvas.height / 2 - ((lines.length - 1) * lineHeight) / 2;
    
    lines.forEach((line, i) => {
      ctx.fillText(line, canvas.width / 2, startY + i * lineHeight);
    });
  }

  // Cache for loaded images to avoid reloading
  const imageCache = new Map();
  
  function renderImageSegmentToComposition(segment, ctx, canvas) {
    const asset = VE.state.assets.find(a => a.id === segment.assetId);
    if (!asset) {
      // Draw black background if asset not found
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return;
    }
    
    // Fill with black background
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    const imageUrl = asset.objectUrl || asset.thumbnail || asset.serverUrl;
    if (!imageUrl) {
      return;
    }
    
    // Check cache first
    let img = imageCache.get(imageUrl);
    
    if (img && img.complete && img.naturalWidth > 0) {
      // Image is already loaded, draw it immediately
      drawImageToCanvas(img, ctx, canvas);
    } else {
      // Load image if not in cache or not loaded yet
      if (!img) {
        img = new Image();
        img.crossOrigin = 'anonymous';
        imageCache.set(imageUrl, img);
        
        img.onload = () => {
          // Redraw composition when image loads
          if (VE.state.currentPreviewSegment && VE.state.currentPreviewSegment.type === 'image') {
            VE.renderComposition();
          }
        };
        
        img.onerror = () => {
          // If image fails to load, keep black background
        };
        
        img.src = imageUrl;
      }
      
      // If image is loading, try to draw it (will be blank if not loaded yet)
      if (img.complete && img.naturalWidth > 0) {
        drawImageToCanvas(img, ctx, canvas);
      }
    }
  }
  
  function drawImageToCanvas(img, ctx, canvas) {
    // Calculate dimensions to fit image while maintaining aspect ratio
    const imgAspect = img.width / img.height;
    const canvasAspect = canvas.width / canvas.height;
    
    let drawWidth, drawHeight, drawX, drawY;
    
    if (imgAspect > canvasAspect) {
      // Image is wider - fit to width
      drawWidth = canvas.width;
      drawHeight = canvas.width / imgAspect;
      drawX = 0;
      drawY = (canvas.height - drawHeight) / 2;
    } else {
      // Image is taller - fit to height
      drawHeight = canvas.height;
      drawWidth = canvas.height * imgAspect;
      drawX = (canvas.width - drawWidth) / 2;
      drawY = 0;
    }
    
    ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
  }

  VE.startCompositionRendering = function() {
    VE.stopCompositionRendering();
    
    const render = () => {
      VE.renderComposition();
      compositionAnimationId = requestAnimationFrame(render);
    };
    
    render();
  };

  VE.stopCompositionRendering = function() {
    if (compositionAnimationId) {
      cancelAnimationFrame(compositionAnimationId);
      compositionAnimationId = null;
    }
  };

})();





