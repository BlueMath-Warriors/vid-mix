/**
 * Video Lab Editor - Crop/Transform Module
 * Crop modal, transform controls, text frames
 */

(function() {
  'use strict';
  
  const VE = window.VideoEditor = window.VideoEditor || {};

  // ============================================
  // Crop/Transform State
  // ============================================
  let cropEditingSegment = null;
  let cropDragState = {
    isDragging: false,
    isResizing: false,
    handle: null,
    startX: 0,
    startY: 0,
    startBox: { x: 0, y: 0, width: 0, height: 0 }
  };
  
  let clipDragState = {
    isDragging: false,
    startX: 0,
    startY: 0,
    startPosX: 0,
    startPosY: 0
  };

  // Text frame editing state
  let editingTextFrame = null;
  
  // Image frame editing state
  let editingImageFrame = null;
  let selectedImageAsset = null;

  // ============================================
  // Text Frame Functions
  // ============================================
  VE.openTextModal = function(existingSegment = null) {
    editingTextFrame = existingSegment;
    
    if (existingSegment) {
      VE.elements.textContent.value = existingSegment.text || '';
      VE.elements.textFont.value = existingSegment.font || 'DM Sans';
      VE.elements.textSize.value = existingSegment.fontSize?.toString() || '48';
      VE.elements.textColor.value = existingSegment.color || '#ffffff';
      VE.elements.bgColor.value = existingSegment.bgColor || '#000000';
      VE.elements.textDuration.value = (existingSegment.endOffset - existingSegment.startOffset).toString();
    } else {
      VE.elements.textContent.value = '';
      VE.elements.textFont.value = 'DM Sans';
      VE.elements.textSize.value = '48';
      VE.elements.textColor.value = '#ffffff';
      VE.elements.bgColor.value = '#000000';
      VE.elements.textDuration.value = '3';
    }
    
    VE.updateTextPreview();
    VE.elements.textModal.classList.add('show');
    VE.elements.textContent.focus();
  };

  VE.closeTextModal = function() {
    VE.elements.textModal.classList.remove('show');
    editingTextFrame = null;
  };

  VE.updateTextPreview = function() {
    const text = VE.elements.textContent.value || 'Preview';
    const font = VE.elements.textFont.value;
    const size = Math.min(parseInt(VE.elements.textSize.value), 32);
    const color = VE.elements.textColor.value;
    const bgColor = VE.elements.bgColor.value;
    
    VE.elements.textPreview.style.fontFamily = font;
    VE.elements.textPreview.style.fontSize = `${size}px`;
    VE.elements.textPreview.style.color = color;
    VE.elements.textPreview.style.backgroundColor = bgColor;
    VE.elements.textPreview.textContent = text;
  };

  VE.addTextFrameToTimeline = function() {
    const text = VE.elements.textContent.value.trim();
    if (!text) {
      VE.showToast('warning', 'No Text', 'Please enter some text');
      return;
    }
    
    const duration = parseFloat(VE.elements.textDuration.value) || 3;
    
    if (editingTextFrame) {
      const idx = VE.state.timeline.findIndex(s => s.id === editingTextFrame.id);
      if (idx !== -1) {
        VE.state.timeline[idx] = {
          ...VE.state.timeline[idx],
          text,
          name: text.substring(0, 30),
          font: VE.elements.textFont.value,
          fontSize: parseInt(VE.elements.textSize.value),
          color: VE.elements.textColor.value,
          bgColor: VE.elements.bgColor.value,
          endOffset: VE.state.timeline[idx].startOffset + duration,
          originalDuration: duration
        };
      }
      VE.showToast('success', 'Text Updated');
    } else {
      const textFrame = {
        id: `text-${Date.now()}`,
        type: 'text',
        name: text.substring(0, 30),
        text,
        font: VE.elements.textFont.value,
        fontSize: parseInt(VE.elements.textSize.value),
        color: VE.elements.textColor.value,
        bgColor: VE.elements.bgColor.value,
        duration,
        startOffset: 0,
        endOffset: duration,
        originalDuration: duration,
        colorIndex: 0
      };
      
      VE.state.timeline.push(textFrame);
      VE.showToast('success', 'Text Added');
    }
    
    VE.closeTextModal();
    VE.renderTimeline();
    // Auto-save progress
    if (typeof VE.scheduleProgressSave === 'function') {
      VE.scheduleProgressSave();
    }
  };

  VE.createTextFramePreview = function(segment) {
    const canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    const ctx = canvas.getContext('2d');
    
    ctx.fillStyle = segment.bgColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    ctx.fillStyle = segment.color;
    ctx.font = `bold ${segment.fontSize * 2}px ${segment.font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    const lines = segment.text.split('\n');
    const lineHeight = segment.fontSize * 2.5;
    const totalHeight = lines.length * lineHeight;
    let startY = (canvas.height - totalHeight) / 2 + lineHeight / 2;
    
    lines.forEach((line, i) => {
      ctx.fillText(line, canvas.width / 2, startY + i * lineHeight);
    });
    
    return canvas;
  };

  VE.showTextFrameInPreview = function(segment) {
    const canvas = VE.createTextFramePreview(segment);
    
    VE.elements.previewVideo.classList.remove('active');
    VE.elements.canvasPlaceholder.style.display = 'none';
    
    const ctx = VE.elements.textFrameCanvas.getContext('2d');
    VE.elements.textFrameCanvas.width = canvas.width;
    VE.elements.textFrameCanvas.height = canvas.height;
    ctx.drawImage(canvas, 0, 0);
    VE.elements.textFrameCanvas.classList.add('active');
  };

  VE.hideTextFramePreview = function() {
    VE.elements.textFrameCanvas.classList.remove('active');
  };

  // ============================================
  // Image Frame Functions
  // ============================================
  VE.openImageModal = function(existingSegment = null) {
    editingImageFrame = existingSegment;
    selectedImageAsset = null;
    
    if (existingSegment) {
      // Find the asset for this image frame
      const asset = VE.state.assets.find(a => a.id === existingSegment.assetId);
      if (asset) {
        selectedImageAsset = asset;
      }
      VE.elements.imageDuration.value = (existingSegment.endOffset - existingSegment.startOffset).toString();
    } else {
      VE.elements.imageDuration.value = '3';
    }
    
    // Render available image assets
    VE.renderImageAssetsGrid();
    VE.updateImagePreview();
    VE.elements.imageModal.classList.add('show');
  };

  VE.closeImageModal = function() {
    VE.elements.imageModal.classList.remove('show');
    editingImageFrame = null;
    selectedImageAsset = null;
  };

  VE.renderImageAssetsGrid = function() {
    const grid = VE.elements.imageAssetsGrid;
    const empty = VE.elements.imageAssetsEmpty;
    
    if (!grid || !empty) return;
    
    // Get all image assets from project assets
    const imageAssets = VE.state.assets.filter(a => 
      a.isProjectAsset && a.type === 'image'
    );
    
    if (imageAssets.length === 0) {
      grid.style.display = 'none';
      empty.style.display = 'flex';
      return;
    }
    
    grid.style.display = 'grid';
    empty.style.display = 'none';
    grid.innerHTML = '';
    
    imageAssets.forEach(asset => {
      const item = document.createElement('div');
      item.className = `image-asset-item ${selectedImageAsset?.id === asset.id ? 'selected' : ''}`;
      item.innerHTML = `
        <img src="${asset.thumbnail || asset.objectUrl}" alt="${asset.name}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
        <div class="image-placeholder" style="display:none;"><i class="fas fa-image"></i></div>
        <div class="image-asset-name">${asset.name || 'Image'}</div>
      `;
      
      item.addEventListener('click', () => {
        selectedImageAsset = asset;
        VE.renderImageAssetsGrid();
        VE.updateImagePreview();
        VE.elements.addImageBtn.disabled = false;
      });
      
      grid.appendChild(item);
    });
  };

  VE.updateImagePreview = function() {
    const preview = VE.elements.imagePreview;
    if (!preview) return;
    
    if (selectedImageAsset) {
      preview.innerHTML = `<img src="${selectedImageAsset.objectUrl || selectedImageAsset.thumbnail}" alt="Preview" style="max-width: 100%; max-height: 300px; object-fit: contain;">`;
    } else {
      preview.innerHTML = '<p style="color: var(--text-muted);">Select an image to preview</p>';
    }
  };

  VE.addImageFrameToTimeline = function() {
    if (!selectedImageAsset) {
      VE.showToast('warning', 'No Image', 'Please select an image');
      return;
    }
    
    const duration = parseFloat(VE.elements.imageDuration.value) || 3;
    
    if (editingImageFrame) {
      const idx = VE.state.timeline.findIndex(s => s.id === editingImageFrame.id);
      if (idx !== -1) {
        VE.state.timeline[idx] = {
          ...VE.state.timeline[idx],
          assetId: selectedImageAsset.id,
          name: selectedImageAsset.name || 'Image',
          endOffset: VE.state.timeline[idx].startOffset + duration,
          originalDuration: duration
        };
      }
      VE.showToast('success', 'Image Updated');
    } else {
      const imageFrame = {
        id: `image-${Date.now()}`,
        type: 'image',
        name: selectedImageAsset.name || 'Image',
        assetId: selectedImageAsset.id,
        duration,
        startOffset: 0,
        endOffset: duration,
        originalDuration: duration,
        colorIndex: 0
      };
      
      VE.state.timeline.push(imageFrame);
      VE.showToast('success', 'Image Added');
    }
    
    VE.closeImageModal();
    VE.renderTimeline();
    // Auto-save progress
    if (typeof VE.scheduleProgressSave === 'function') {
      VE.scheduleProgressSave();
    }
  };

  VE.createImageFramePreview = function(segment) {
    return new Promise((resolve) => {
      const asset = VE.state.assets.find(a => a.id === segment.assetId);
      if (!asset) {
        // Return a black canvas if asset not found
        const canvas = document.createElement('canvas');
        canvas.width = VE.state.projectResolution.width || 1920;
        canvas.height = VE.state.projectResolution.height || 1080;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        resolve(canvas);
        return;
      }
      
      const canvas = document.createElement('canvas');
      canvas.width = VE.state.projectResolution.width || 1920;
      canvas.height = VE.state.projectResolution.height || 1080;
      const ctx = canvas.getContext('2d');
      
      // Fill with black background
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // Load and draw image
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
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
        resolve(canvas);
      };
      img.onerror = () => {
        // If image fails to load, return black canvas
        resolve(canvas);
      };
      img.src = asset.objectUrl || asset.thumbnail || asset.serverUrl;
    });
  };

  VE.showImageFrameInPreview = async function(segment) {
    const canvas = await VE.createImageFramePreview(segment);
    if (!canvas) return;
    
    VE.elements.previewVideo.classList.remove('active');
    VE.elements.canvasPlaceholder.style.display = 'none';
    
    const ctx = VE.elements.imageFrameCanvas.getContext('2d');
    VE.elements.imageFrameCanvas.width = canvas.width;
    VE.elements.imageFrameCanvas.height = canvas.height;
    ctx.drawImage(canvas, 0, 0);
    VE.elements.imageFrameCanvas.classList.add('active');
  };

  VE.hideImageFramePreview = function() {
    VE.elements.imageFrameCanvas.classList.remove('active');
  };

  // ============================================
  // Crop Functions
  // ============================================
  VE.openCropModal = function(segmentId) {
    const segment = VE.state.timeline.find(s => s.id === segmentId);
    if (!segment) {
      VE.showToast('warning', 'No Segment', 'Select a video clip to crop');
      return;
    }
    
    if (segment.type === 'text' || segment.type === 'image') {
      VE.showToast('warning', 'Cannot Crop', 'Text and image frames cannot be cropped');
      return;
    }
    
    const asset = VE.state.assets.find(a => a.id === segment.assetId);
    if (!asset) {
      VE.showToast('error', 'Asset Not Found', 'The video asset could not be found');
      return;
    }
    
    cropEditingSegment = segment;
    VE.state.cropSegmentId = segmentId;
    
    // Load video into crop preview
    VE.elements.cropPreviewVideo.src = asset.objectUrl;
    VE.elements.cropPreviewVideo.currentTime = segment.startOffset + 0.1;
    
    VE.elements.cropPreviewVideo.onloadedmetadata = () => {
      VE.state.cropVideoWidth = VE.elements.cropPreviewVideo.videoWidth;
      VE.state.cropVideoHeight = VE.elements.cropPreviewVideo.videoHeight;
      
      // Initialize crop box from existing crop data or full frame
      if (segment.crop) {
        VE.state.cropBox = { ...segment.crop };
      } else {
        VE.state.cropBox = {
          x: 0,
          y: 0,
          width: VE.state.cropVideoWidth,
          height: VE.state.cropVideoHeight
        };
      }
      
      VE.updateCropBoxVisual();
      VE.updateCropInputs();
    };
    
    // Reset aspect ratio selection
    VE.state.cropAspectRatio = 'free';
    VE.elements.presetBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.ratio === 'free');
    });
    
    VE.elements.cropModal.classList.add('show');
  };

  VE.closeCropModal = function() {
    VE.elements.cropModal.classList.remove('show');
    cropEditingSegment = null;
    VE.state.cropSegmentId = null;
    VE.elements.cropPreviewVideo.src = '';
  };

  VE.updateCropBoxVisual = function() {
    if (!VE.elements.cropPreviewWrapper || !VE.elements.cropBox) return;
    
    const wrapperRect = VE.elements.cropPreviewWrapper.getBoundingClientRect();
    const videoWidth = VE.state.cropVideoWidth;
    const videoHeight = VE.state.cropVideoHeight;
    
    if (videoWidth === 0 || videoHeight === 0) return;
    
    // Calculate the actual video display size within the wrapper (object-fit: contain)
    const wrapperAspect = wrapperRect.width / wrapperRect.height;
    const videoAspect = videoWidth / videoHeight;
    
    let displayWidth, displayHeight, offsetX, offsetY;
    
    if (videoAspect > wrapperAspect) {
      // Video is wider than wrapper
      displayWidth = wrapperRect.width;
      displayHeight = wrapperRect.width / videoAspect;
      offsetX = 0;
      offsetY = (wrapperRect.height - displayHeight) / 2;
    } else {
      // Video is taller than wrapper
      displayHeight = wrapperRect.height;
      displayWidth = wrapperRect.height * videoAspect;
      offsetX = (wrapperRect.width - displayWidth) / 2;
      offsetY = 0;
    }
    
    // Convert crop box from video coordinates to display coordinates
    const scaleX = displayWidth / videoWidth;
    const scaleY = displayHeight / videoHeight;
    
    const boxLeft = offsetX + (VE.state.cropBox.x * scaleX);
    const boxTop = offsetY + (VE.state.cropBox.y * scaleY);
    const boxWidth = VE.state.cropBox.width * scaleX;
    const boxHeight = VE.state.cropBox.height * scaleY;
    
    VE.elements.cropBox.style.left = `${boxLeft}px`;
    VE.elements.cropBox.style.top = `${boxTop}px`;
    VE.elements.cropBox.style.width = `${boxWidth}px`;
    VE.elements.cropBox.style.height = `${boxHeight}px`;
  };

  VE.updateCropInputs = function() {
    // Crop inputs were removed in the modal redesign
    // Crop box state is managed internally
  };

  function getCropDisplayMetrics() {
    const wrapperRect = VE.elements.cropPreviewWrapper.getBoundingClientRect();
    const videoWidth = VE.state.cropVideoWidth;
    const videoHeight = VE.state.cropVideoHeight;
    
    const wrapperAspect = wrapperRect.width / wrapperRect.height;
    const videoAspect = videoWidth / videoHeight;
    
    let displayWidth, displayHeight, offsetX, offsetY;
    
    if (videoAspect > wrapperAspect) {
      displayWidth = wrapperRect.width;
      displayHeight = wrapperRect.width / videoAspect;
      offsetX = 0;
      offsetY = (wrapperRect.height - displayHeight) / 2;
    } else {
      displayHeight = wrapperRect.height;
      displayWidth = wrapperRect.height * videoAspect;
      offsetX = (wrapperRect.width - displayWidth) / 2;
      offsetY = 0;
    }
    
    return {
      displayWidth,
      displayHeight,
      offsetX,
      offsetY,
      scaleX: displayWidth / videoWidth,
      scaleY: displayHeight / videoHeight,
      wrapperRect
    };
  }

  VE.setupCropDragHandlers = function() {
    if (!VE.elements.cropBox || !VE.elements.cropPreviewWrapper) return;
    
    // Drag the entire crop box
    VE.elements.cropBox.addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('crop-handle')) return;
      
      e.preventDefault();
      cropDragState.isDragging = true;
      cropDragState.isResizing = false;
      cropDragState.startX = e.clientX;
      cropDragState.startY = e.clientY;
      cropDragState.startBox = { ...VE.state.cropBox };
      
      document.body.style.cursor = 'move';
      document.body.style.userSelect = 'none';
    });
    
    // Resize handles
    const handles = VE.elements.cropBox.querySelectorAll('.crop-handle');
    handles.forEach(handle => {
      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        cropDragState.isDragging = false;
        cropDragState.isResizing = true;
        cropDragState.handle = handle.dataset.handle;
        cropDragState.startX = e.clientX;
        cropDragState.startY = e.clientY;
        cropDragState.startBox = { ...VE.state.cropBox };
        
        document.body.style.cursor = handle.style.cursor || 'se-resize';
        document.body.style.userSelect = 'none';
      });
    });
    
    // Mouse move - throttled for better performance (60fps max)
    document.addEventListener('mousemove', VE.throttle(onCropMouseMove, 16));
    document.addEventListener('mouseup', onCropMouseUp);
  };

  function onCropMouseMove(e) {
    if (!cropDragState.isDragging && !cropDragState.isResizing) return;
    
    const metrics = getCropDisplayMetrics();
    const deltaX = (e.clientX - cropDragState.startX) / metrics.scaleX;
    const deltaY = (e.clientY - cropDragState.startY) / metrics.scaleY;
    
    if (cropDragState.isDragging) {
      // Move the crop box
      let newX = cropDragState.startBox.x + deltaX;
      let newY = cropDragState.startBox.y + deltaY;
      
      // Constrain to video bounds
      newX = Math.max(0, Math.min(newX, VE.state.cropVideoWidth - VE.state.cropBox.width));
      newY = Math.max(0, Math.min(newY, VE.state.cropVideoHeight - VE.state.cropBox.height));
      
      VE.state.cropBox.x = newX;
      VE.state.cropBox.y = newY;
    } else if (cropDragState.isResizing) {
      // Resize based on handle
      const handle = cropDragState.handle;
      const start = cropDragState.startBox;
      
      let newX = start.x;
      let newY = start.y;
      let newWidth = start.width;
      let newHeight = start.height;
      
      // Handle each resize direction
      if (handle.includes('e')) {
        newWidth = Math.max(20, start.width + deltaX);
      }
      if (handle.includes('w')) {
        const widthChange = Math.min(deltaX, start.width - 20);
        newX = start.x + widthChange;
        newWidth = start.width - widthChange;
      }
      if (handle.includes('s')) {
        newHeight = Math.max(20, start.height + deltaY);
      }
      if (handle.includes('n')) {
        const heightChange = Math.min(deltaY, start.height - 20);
        newY = start.y + heightChange;
        newHeight = start.height - heightChange;
      }
      
      // Constrain to video bounds
      newX = Math.max(0, newX);
      newY = Math.max(0, newY);
      newWidth = Math.min(newWidth, VE.state.cropVideoWidth - newX);
      newHeight = Math.min(newHeight, VE.state.cropVideoHeight - newY);
      
      // Apply aspect ratio constraint if set
      if (VE.state.cropAspectRatio !== 'free') {
        const ratio = VE.parseAspectRatio(VE.state.cropAspectRatio);
        if (ratio) {
          // Adjust height to match aspect ratio
          if (handle.includes('e') || handle.includes('w')) {
            newHeight = newWidth / ratio;
          } else {
            newWidth = newHeight * ratio;
          }
          
          // Re-constrain after aspect ratio adjustment
          if (newX + newWidth > VE.state.cropVideoWidth) {
            newWidth = VE.state.cropVideoWidth - newX;
            newHeight = newWidth / ratio;
          }
          if (newY + newHeight > VE.state.cropVideoHeight) {
            newHeight = VE.state.cropVideoHeight - newY;
            newWidth = newHeight * ratio;
          }
        }
      }
      
      VE.state.cropBox = { x: newX, y: newY, width: newWidth, height: newHeight };
    }
    
    VE.updateCropBoxVisual();
    VE.updateCropInputs();
  }

  function onCropMouseUp() {
    if (cropDragState.isDragging || cropDragState.isResizing) {
      cropDragState.isDragging = false;
      cropDragState.isResizing = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  }

  VE.parseAspectRatio = function(ratioStr) {
    if (ratioStr === 'free') return null;
    if (ratioStr === 'project') {
      return VE.state.projectResolution.width / VE.state.projectResolution.height;
    }
    const parts = ratioStr.split(':');
    if (parts.length === 2) {
      return parseFloat(parts[0]) / parseFloat(parts[1]);
    }
    return null;
  };

  VE.setAspectRatioPreset = function(ratio) {
    VE.state.cropAspectRatio = ratio;
    
    VE.elements.presetBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.ratio === ratio);
    });
    
    if (ratio === 'free') return;
    
    // Handle "project" preset - match project resolution aspect ratio
    let aspectRatio;
    if (ratio === 'project') {
      aspectRatio = VE.state.projectResolution.width / VE.state.projectResolution.height;
    } else {
      aspectRatio = VE.parseAspectRatio(ratio);
    }
    
    if (!aspectRatio) return;
    
    // Calculate new crop box dimensions maintaining aspect ratio
    // Center the crop box and maximize size within video
    const videoAspect = VE.state.cropVideoWidth / VE.state.cropVideoHeight;
    
    let newWidth, newHeight;
    
    if (aspectRatio > videoAspect) {
      // Crop is wider than video
      newWidth = VE.state.cropVideoWidth;
      newHeight = newWidth / aspectRatio;
    } else {
      // Crop is taller than video
      newHeight = VE.state.cropVideoHeight;
      newWidth = newHeight * aspectRatio;
    }
    
    VE.state.cropBox = {
      x: (VE.state.cropVideoWidth - newWidth) / 2,
      y: (VE.state.cropVideoHeight - newHeight) / 2,
      width: newWidth,
      height: newHeight
    };
    
    VE.updateCropBoxVisual();
    VE.updateCropInputs();
  };

  VE.resetCrop = function() {
    VE.state.cropBox = {
      x: 0,
      y: 0,
      width: VE.state.cropVideoWidth,
      height: VE.state.cropVideoHeight
    };
    VE.state.cropAspectRatio = 'free';
    
    VE.elements.presetBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.ratio === 'free');
    });
    
    VE.updateCropBoxVisual();
    VE.updateCropInputs();
  };

  VE.applyCrop = function() {
    if (!cropEditingSegment) return;
    
    const segIndex = VE.state.timeline.findIndex(s => s.id === cropEditingSegment.id);
    if (segIndex === -1) return;
    
    // Check if crop is essentially full frame (no crop needed)
    const isFullFrame = 
      Math.abs(VE.state.cropBox.x) < 1 &&
      Math.abs(VE.state.cropBox.y) < 1 &&
      Math.abs(VE.state.cropBox.width - VE.state.cropVideoWidth) < 1 &&
      Math.abs(VE.state.cropBox.height - VE.state.cropVideoHeight) < 1;
    
    if (isFullFrame) {
      // Remove crop data
      delete VE.state.timeline[segIndex].crop;
      VE.showToast('info', 'Crop Reset', 'Clip will show full frame');
    } else {
      // Save crop data to segment
      VE.state.timeline[segIndex].crop = {
        x: Math.round(VE.state.cropBox.x),
        y: Math.round(VE.state.cropBox.y),
        width: Math.round(VE.state.cropBox.width),
        height: Math.round(VE.state.cropBox.height)
      };
      VE.showToast('success', 'Crop Applied', 'Clip cropping saved');
    }
    
    const updatedSegment = VE.state.timeline[segIndex];
    
    VE.closeCropModal();
    VE.renderTimeline();
    
    // Update preview to show the crop effect
    VE.state.currentPreviewSegment = updatedSegment;
    if (updatedSegment.crop) {
      VE.startCropPreviewRendering(updatedSegment);
    } else {
      VE.stopCropPreviewRendering();
    }
    // Auto-save progress
    if (typeof VE.scheduleProgressSave === 'function') {
      VE.scheduleProgressSave();
    }
  };

  // ============================================
  // Clip Transform Functions
  // ============================================
  VE.openClipTransformModal = function(segmentId) {
    const segment = VE.state.timeline.find(s => s.id === segmentId);
    if (!segment) {
      VE.showToast('warning', 'No Clip', 'Select a video clip to edit');
      return;
    }
    
    if (segment.type === 'text' || segment.type === 'image') {
      VE.showToast('warning', 'Cannot Transform', 'Text and image frames cannot be transformed this way');
      return;
    }
    
    const asset = VE.state.assets.find(a => a.id === segment.assetId);
    if (!asset) {
      VE.showToast('error', 'Asset Not Found', 'The video asset could not be found');
      return;
    }
    
    cropEditingSegment = segment;
    VE.state.cropSegmentId = segmentId;
    
    // Initialize transform state from segment
    const transform = segment.transform || VE.getDefaultTransform(segment);
    const crop = segment.crop || null;
    
    VE.state.editingTransform = {
      x: transform.x,
      y: transform.y,
      scale: transform.scale,
      cropX: crop ? crop.x : 0,
      cropY: crop ? crop.y : 0,
      cropWidth: crop ? crop.width : 0,
      cropHeight: crop ? crop.height : 0
    };
    
    // Load video into crop preview
    VE.elements.cropPreviewVideo.src = asset.objectUrl;
    VE.elements.cropPreviewVideo.currentTime = segment.startOffset + 0.1;
    
    // Also load into position preview
    if (VE.elements.positionPreviewVideo) {
      VE.elements.positionPreviewVideo.src = asset.objectUrl;
      VE.elements.positionPreviewVideo.currentTime = segment.startOffset + 0.1;
    }
    
    VE.elements.cropPreviewVideo.onloadedmetadata = () => {
      VE.state.cropVideoWidth = VE.elements.cropPreviewVideo.videoWidth;
      VE.state.cropVideoHeight = VE.elements.cropPreviewVideo.videoHeight;
      
      // Initialize crop box
      if (crop) {
        VE.state.cropBox = { ...crop };
      } else {
        VE.state.cropBox = {
          x: 0,
          y: 0,
          width: VE.state.cropVideoWidth,
          height: VE.state.cropVideoHeight
        };
        VE.state.editingTransform.cropWidth = VE.state.cropVideoWidth;
        VE.state.editingTransform.cropHeight = VE.state.cropVideoHeight;
      }
      
      VE.updateCropBoxVisual();
      VE.updateTransformInputs();
      VE.updateCanvasPositionPreview();
    };
    
    // Update project resolution hint
    if (VE.elements.projectResHint) {
      VE.elements.projectResHint.textContent = `${VE.state.projectResolution.width}×${VE.state.projectResolution.height}`;
    }
    
    // Update canvas frame aspect ratio
    updateCanvasFrameRatio();
    
    // Reset crop ratio selection
    VE.state.cropAspectRatio = 'free';
    VE.elements.presetBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.ratio === 'free');
    });
    
    VE.elements.cropModal.classList.add('show');
    
    // Setup clip box drag in position preview
    VE.setupClipBoxDrag();
  };

  function updateCanvasFrameRatio() {
    if (!VE.elements.canvasFrame) return;
    
    VE.elements.canvasFrame.classList.remove('ratio-9-16', 'ratio-1-1', 'ratio-4-3', 'ratio-4-5', 'ratio-21-9');
    
    // Calculate aspect ratio from dimensions
    const width = VE.state.projectResolution.width;
    const height = VE.state.projectResolution.height;
    const ratio = width / height;
    
    let ratioClass = '';
    if (ratio < 0.6) {
      ratioClass = 'ratio-9-16';
    } else if (ratio >= 0.6 && ratio < 0.85) {
      ratioClass = 'ratio-4-5';
    } else if (ratio >= 0.85 && ratio < 1.15) {
      ratioClass = 'ratio-1-1';
    } else if (ratio >= 1.15 && ratio < 1.5) {
      ratioClass = 'ratio-4-3';
    } else if (ratio >= 2.0) {
      ratioClass = 'ratio-21-9';
    }
    // 16:9 is default, no class needed
    
    if (ratioClass) {
      VE.elements.canvasFrame.classList.add(ratioClass);
    }
  }

  VE.updateTransformInputs = function() {
    if (VE.elements.clipPosX) {
      VE.elements.clipPosX.value = Math.round(VE.state.editingTransform.x);
    }
    if (VE.elements.clipPosY) {
      VE.elements.clipPosY.value = Math.round(VE.state.editingTransform.y);
    }
    if (VE.elements.clipScale) {
      VE.elements.clipScale.value = VE.state.editingTransform.scale;
    }
    if (VE.elements.clipScaleSlider) {
      VE.elements.clipScaleSlider.value = VE.state.editingTransform.scale;
    }
  };

  VE.updateCanvasPositionPreview = function() {
    if (!VE.elements.clipPreviewBox || !VE.elements.canvasFrame) return;
    
    const frameRect = VE.elements.canvasFrame.getBoundingClientRect();
    const scaleX = frameRect.width / VE.state.projectResolution.width;
    const scaleY = frameRect.height / VE.state.projectResolution.height;
    
    // Calculate clip dimensions based on scale
    const clipScale = VE.state.editingTransform.scale / 100;
    const cropWidth = VE.state.editingTransform.cropWidth || VE.state.cropVideoWidth || VE.state.projectResolution.width;
    const cropHeight = VE.state.editingTransform.cropHeight || VE.state.cropVideoHeight || VE.state.projectResolution.height;
    
    // Scale to fit the project width, then apply transform scale
    const fitScale = VE.state.projectResolution.width / cropWidth;
    const clipWidth = cropWidth * fitScale * clipScale;
    const clipHeight = cropHeight * fitScale * clipScale;
    
    // Apply position
    const left = VE.state.editingTransform.x * scaleX;
    const top = VE.state.editingTransform.y * scaleY;
    const width = clipWidth * scaleX;
    const height = clipHeight * scaleY;
    
    VE.elements.clipPreviewBox.style.left = `${left}px`;
    VE.elements.clipPreviewBox.style.top = `${top}px`;
    VE.elements.clipPreviewBox.style.width = `${width}px`;
    VE.elements.clipPreviewBox.style.height = `${height}px`;
    VE.elements.clipPreviewBox.style.transform = 'none';
  };

  VE.setupClipBoxDrag = function() {
    if (!VE.elements.clipPreviewBox || !VE.elements.canvasFrame) return;
    
    VE.elements.clipPreviewBox.addEventListener('mousedown', (e) => {
      e.preventDefault();
      clipDragState.isDragging = true;
      clipDragState.startX = e.clientX;
      clipDragState.startY = e.clientY;
      clipDragState.startPosX = VE.state.editingTransform.x;
      clipDragState.startPosY = VE.state.editingTransform.y;
      
      document.body.style.cursor = 'move';
      document.body.style.userSelect = 'none';
    });
  };

  VE.handleClipBoxDrag = function(e) {
    if (!clipDragState.isDragging || !VE.elements.canvasFrame) return;
    
    const frameRect = VE.elements.canvasFrame.getBoundingClientRect();
    const scaleX = VE.state.projectResolution.width / frameRect.width;
    const scaleY = VE.state.projectResolution.height / frameRect.height;
    
    const deltaX = (e.clientX - clipDragState.startX) * scaleX;
    const deltaY = (e.clientY - clipDragState.startY) * scaleY;
    
    VE.state.editingTransform.x = Math.round(clipDragState.startPosX + deltaX);
    VE.state.editingTransform.y = Math.round(clipDragState.startPosY + deltaY);
    
    VE.updateTransformInputs();
    VE.updateCanvasPositionPreview();
  };

  VE.handleClipBoxDragEnd = function() {
    if (clipDragState.isDragging) {
      clipDragState.isDragging = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  };

  VE.setClipPosition = function(position) {
    const cropWidth = VE.state.editingTransform.cropWidth || VE.state.cropVideoWidth || VE.state.projectResolution.width;
    const cropHeight = VE.state.editingTransform.cropHeight || VE.state.cropVideoHeight || VE.state.projectResolution.height;
    const clipScale = VE.state.editingTransform.scale / 100;
    
    const fitScale = VE.state.projectResolution.width / cropWidth;
    const clipWidth = cropWidth * fitScale * clipScale;
    const clipHeight = cropHeight * fitScale * clipScale;
    
    const projW = VE.state.projectResolution.width;
    const projH = VE.state.projectResolution.height;
    
    switch (position) {
      case 'top-left':
        VE.state.editingTransform.x = 0;
        VE.state.editingTransform.y = 0;
        break;
      case 'top-center':
        VE.state.editingTransform.x = (projW - clipWidth) / 2;
        VE.state.editingTransform.y = 0;
        break;
      case 'top-right':
        VE.state.editingTransform.x = projW - clipWidth;
        VE.state.editingTransform.y = 0;
        break;
      case 'center-left':
        VE.state.editingTransform.x = 0;
        VE.state.editingTransform.y = (projH - clipHeight) / 2;
        break;
      case 'center':
        VE.state.editingTransform.x = (projW - clipWidth) / 2;
        VE.state.editingTransform.y = (projH - clipHeight) / 2;
        break;
      case 'center-right':
        VE.state.editingTransform.x = projW - clipWidth;
        VE.state.editingTransform.y = (projH - clipHeight) / 2;
        break;
      case 'bottom-left':
        VE.state.editingTransform.x = 0;
        VE.state.editingTransform.y = projH - clipHeight;
        break;
      case 'bottom-center':
        VE.state.editingTransform.x = (projW - clipWidth) / 2;
        VE.state.editingTransform.y = projH - clipHeight;
        break;
      case 'bottom-right':
        VE.state.editingTransform.x = projW - clipWidth;
        VE.state.editingTransform.y = projH - clipHeight;
        break;
    }
    
    VE.updateTransformInputs();
    VE.updateCanvasPositionPreview();
  };

  VE.fitClipToCanvas = function() {
    // Scale clip to fill the entire canvas
    const cropWidth = VE.state.editingTransform.cropWidth || VE.state.cropVideoWidth || VE.state.projectResolution.width;
    const cropHeight = VE.state.editingTransform.cropHeight || VE.state.cropVideoHeight || VE.state.projectResolution.height;
    
    const projW = VE.state.projectResolution.width;
    const projH = VE.state.projectResolution.height;
    
    const fitScale = VE.state.projectResolution.width / cropWidth;
    
    // Calculate scale to cover the entire canvas
    const scaleToFitWidth = projW / (cropWidth * fitScale);
    const scaleToFitHeight = projH / (cropHeight * fitScale);
    const coverScale = Math.max(scaleToFitWidth, scaleToFitHeight) * 100;
    
    VE.state.editingTransform.scale = Math.round(coverScale);
    VE.state.editingTransform.x = 0;
    VE.state.editingTransform.y = 0;
    
    // Center if needed
    const clipWidth = cropWidth * fitScale * (VE.state.editingTransform.scale / 100);
    const clipHeight = cropHeight * fitScale * (VE.state.editingTransform.scale / 100);
    
    if (clipWidth > projW) {
      VE.state.editingTransform.x = -(clipWidth - projW) / 2;
    }
    if (clipHeight > projH) {
      VE.state.editingTransform.y = -(clipHeight - projH) / 2;
    }
    
    VE.updateTransformInputs();
    VE.updateCanvasPositionPreview();
  };

  VE.applyClipTransform = function() {
    if (!cropEditingSegment) return;
    
    const segIndex = VE.state.timeline.findIndex(s => s.id === cropEditingSegment.id);
    if (segIndex === -1) return;
    
    // Save crop data
    const isFullFrame = 
      Math.abs(VE.state.cropBox.x) < 1 &&
      Math.abs(VE.state.cropBox.y) < 1 &&
      Math.abs(VE.state.cropBox.width - VE.state.cropVideoWidth) < 1 &&
      Math.abs(VE.state.cropBox.height - VE.state.cropVideoHeight) < 1;
    
    if (isFullFrame) {
      delete VE.state.timeline[segIndex].crop;
    } else {
      VE.state.timeline[segIndex].crop = {
        x: Math.round(VE.state.cropBox.x),
        y: Math.round(VE.state.cropBox.y),
        width: Math.round(VE.state.cropBox.width),
        height: Math.round(VE.state.cropBox.height)
      };
    }
    
    // Save transform data
    VE.state.timeline[segIndex].transform = {
      x: Math.round(VE.state.editingTransform.x),
      y: Math.round(VE.state.editingTransform.y),
      scale: VE.state.editingTransform.scale
    };
    
    VE.showToast('success', 'Changes Applied', 'Clip transform saved');
    
    VE.closeCropModal();
    VE.renderTimeline();
    VE.renderComposition();
    // Auto-save progress
    if (typeof VE.scheduleProgressSave === 'function') {
      VE.scheduleProgressSave();
    }
  };

  VE.resetClipTransform = function() {
    // Reset crop to full frame
    VE.state.cropBox = {
      x: 0,
      y: 0,
      width: VE.state.cropVideoWidth,
      height: VE.state.cropVideoHeight
    };
    VE.state.cropAspectRatio = 'free';
    
    // Reset transform to centered and fit
    VE.state.editingTransform = {
      x: 0,
      y: 0,
      scale: 100,
      cropX: 0,
      cropY: 0,
      cropWidth: VE.state.cropVideoWidth,
      cropHeight: VE.state.cropVideoHeight
    };
    
    // Update UI
    VE.elements.presetBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.ratio === 'free');
    });
    
    VE.updateCropBoxVisual();
    VE.updateCropInputs();
    VE.updateTransformInputs();
    VE.updateCanvasPositionPreview();
    
    VE.showToast('info', 'Reset', 'All changes reset');
  };

  VE.setupTransformEventListeners = function() {
    // Clip box drag - throttled for smoother performance
    document.addEventListener('mousemove', VE.throttle(VE.handleClipBoxDrag, 16));
    document.addEventListener('mouseup', VE.handleClipBoxDragEnd);
    
    // Position inputs
    if (VE.elements.clipPosX) {
      VE.elements.clipPosX.addEventListener('change', () => {
        VE.state.editingTransform.x = parseInt(VE.elements.clipPosX.value) || 0;
        VE.updateCanvasPositionPreview();
      });
    }
    
    if (VE.elements.clipPosY) {
      VE.elements.clipPosY.addEventListener('change', () => {
        VE.state.editingTransform.y = parseInt(VE.elements.clipPosY.value) || 0;
        VE.updateCanvasPositionPreview();
      });
    }
    
    // Scale controls
    if (VE.elements.clipScale) {
      VE.elements.clipScale.addEventListener('change', () => {
        const scale = parseInt(VE.elements.clipScale.value) || 100;
        VE.state.editingTransform.scale = Math.max(10, Math.min(200, scale));
        VE.elements.clipScale.value = VE.state.editingTransform.scale;
        if (VE.elements.clipScaleSlider) {
          VE.elements.clipScaleSlider.value = VE.state.editingTransform.scale;
        }
        VE.updateCanvasPositionPreview();
      });
    }
    
    if (VE.elements.clipScaleSlider) {
      VE.elements.clipScaleSlider.addEventListener('input', () => {
        VE.state.editingTransform.scale = parseInt(VE.elements.clipScaleSlider.value);
        if (VE.elements.clipScale) {
          VE.elements.clipScale.value = VE.state.editingTransform.scale;
        }
        VE.updateCanvasPositionPreview();
      });
    }
    
    // Position preset buttons
    if (VE.elements.positionPresetBtns) {
      VE.elements.positionPresetBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          VE.setClipPosition(btn.dataset.position);
        });
      });
    }
    
    // Fit to canvas button
    if (VE.elements.fitCanvasBtn) {
      VE.elements.fitCanvasBtn.addEventListener('click', VE.fitClipToCanvas);
    }
  };

  VE.getDefaultTransform = function(segment) {
    return {
      x: 0,
      y: 0,
      scale: 100
    };
  };

})();





