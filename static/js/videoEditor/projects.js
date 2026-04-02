/**
 * Video Lab Editor - Projects Module
 * Project loading and management (project list is in main index.html)
 */

(function() {
  'use strict';
  
  const VE = window.VideoEditor = window.VideoEditor || {};

  // Project state
  VE.projectState = {
    currentProjectId: null,
    currentProject: null
  };

  let overlayFocusTrapCleanup = null;

  VE._beginOverlayFocusTrap = function(rootEl) {
    VE._endOverlayFocusTrap();
    if (!rootEl) {
      return;
    }
    const sel = rootEl.querySelectorAll(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    const focusable = Array.prototype.filter.call(sel, function(el) {
      return el.offsetParent !== null || el === document.activeElement;
    });
    const prev = document.activeElement;
    function onKeyDown(e) {
      if (e.key !== 'Tab' || focusable.length === 0) {
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    rootEl.addEventListener('keydown', onKeyDown);
    overlayFocusTrapCleanup = function() {
      rootEl.removeEventListener('keydown', onKeyDown);
      overlayFocusTrapCleanup = null;
      try {
        if (prev && typeof prev.focus === 'function') {
          prev.focus();
        }
      } catch (err) { /* ignore */ }
    };
    setTimeout(function() {
      if (focusable[0]) {
        focusable[0].focus();
      }
    }, 0);
  };

  VE._endOverlayFocusTrap = function() {
    if (overlayFocusTrapCleanup) {
      overlayFocusTrapCleanup();
    }
  };

  // ============================================
  // Project URL Handling
  // ============================================
  VE.getProjectIdFromUrl = function() {
    try {
      const pathParts = window.location.pathname.split('/').filter(part => part);
      const pi = pathParts.indexOf('p');
      if (pi >= 0 && pathParts[pi + 1] && pathParts[pi + 1].length > 10) {
        return pathParts[pi + 1];
      }
    } catch (e) {
      console.error('Error parsing project ID from URL:', e);
    }
    return null;
  };

  VE.setupProjectErrorOverlay = function() {
    const ov = document.getElementById('project-error-overlay');
    const newBtn = document.getElementById('project-error-new-btn');
    const homeBtn = document.getElementById('project-error-home-btn');
    if (!ov || !newBtn || !homeBtn) {
      return;
    }
    if (newBtn.dataset.bound === '1') {
      return;
    }
    newBtn.dataset.bound = '1';
    homeBtn.dataset.bound = '1';
    newBtn.addEventListener('click', async function() {
      VE._endOverlayFocusTrap();
      ov.style.display = 'none';
      try {
        const res = await window.apiService.request('/projects', {
          method: 'POST',
          body: JSON.stringify({ title: 'Untitled' })
        });
        if (res && res.success && res.project && res.project.id) {
          window.location.replace('/p/' + res.project.id);
        }
      } catch (e) {
        if (typeof VE.showToast === 'function') {
          VE.showToast('error', 'Error', 'Could not create project');
        }
      }
    });
    homeBtn.addEventListener('click', function() {
      VE._endOverlayFocusTrap();
      ov.style.display = 'none';
      window.location.href = '/';
    });
  };

  VE.updateSaveStatus = function(state) {
    const el = document.getElementById('save-status');
    if (!el) {
      return;
    }
    if (state === 'saving') {
      el.hidden = false;
      el.textContent = 'Saving…';
    } else if (state === 'saved') {
      el.hidden = false;
      el.textContent = 'Saved';
      clearTimeout(VE._saveStatusTimer);
      VE._saveStatusTimer = setTimeout(function() {
        el.textContent = '';
        el.hidden = true;
      }, 2000);
    } else if (state === 'error') {
      el.hidden = false;
      el.textContent = 'Save failed';
    } else {
      el.textContent = '';
      el.hidden = true;
    }
  };

  VE.showProjectLoadError = function(message) {
    VE._endOverlayFocusTrap();
    const ov = document.getElementById('project-error-overlay');
    const msg = document.getElementById('project-error-message');
    if (msg) {
      msg.textContent = message || 'This project could not be loaded.';
    }
    if (ov) {
      ov.style.display = 'flex';
      const inner = ov.querySelector('.project-error-inner') || ov.querySelector('.loading-content');
      if (inner) {
        VE._beginOverlayFocusTrap(inner);
      }
    }
  };

  VE.pruneOrphanTimelineSegments = function() {
    const assetIds = new Set((VE.state.assets || []).map(function(a) { return a.id; }));
    let removed = false;
    const keepSeg = function(s) {
      if (s.assetId === undefined || s.assetId === null || s.assetId === '') {
        return true;
      }
      if (assetIds.has(s.assetId)) {
        return true;
      }
      removed = true;
      return false;
    };
    VE.state.timeline = (VE.state.timeline || []).filter(keepSeg);
    VE.state.detachedAudioTimeline = (VE.state.detachedAudioTimeline || []).filter(keepSeg);
    VE.state.customAudioTimeline = (VE.state.customAudioTimeline || []).filter(keepSeg);
    if (removed) {
      if (typeof VE.showToast === 'function') {
        VE.showToast('warning', 'Timeline updated', 'Some clips were removed because their media is missing.');
      }
      if (typeof VE.updateTotalDuration === 'function') {
        VE.updateTotalDuration();
      }
      if (typeof VE.updateAudioDuration === 'function') {
        VE.updateAudioDuration();
      }
      if (typeof VE.renderTimeline === 'function') {
        VE.renderTimeline();
      }
      if (typeof VE.scheduleProgressSave === 'function') {
        VE.scheduleProgressSave();
      }
    }
  };

  // ============================================
  // Project Loading
  // ============================================
  VE.loadProject = async function(projectId) {
    if (!projectId) {
      console.warn('No project ID provided');
      VE.showToast('error', 'Error', 'No project specified.');
      return null;
    }

    VE.audioLoaded = false;
    VE.uploadedAudioFiles = [];

    const loadingOverlay = document.getElementById('video-editor-loading');
    const loadingMsg = document.getElementById('loading-overlay-message');
    if (loadingMsg) {
      loadingMsg.textContent = 'Loading project…';
    }
    const loadingRoot = document.querySelector('#video-editor-loading .loading-content');
    if (loadingOverlay) {
      loadingOverlay.style.display = 'flex';
      if (loadingRoot) {
        VE._beginOverlayFocusTrap(loadingRoot);
      }
    }

    try {
      const response = await window.apiService.request(`/projects/${projectId}`);

      if (response && response.success && response.project) {
        VE.projectState.currentProjectId = projectId;
        VE.projectState.currentProject = response.project;

        const projectTitle = document.getElementById('project-title');
        if (projectTitle) {
          projectTitle.textContent = response.project.title || 'Untitled Project';
        }

        document.title = `${response.project.title || 'Untitled'} - Video Editor`;

        await VE.loadProjectVideos(projectId);

        if (response.project.progress_data) {
          await new Promise((resolve) => {
            setTimeout(() => {
              VE.loadProgress(response.project.progress_data);
              VE.pruneOrphanTimelineSegments();
              resolve();
            }, 500);
          });
        } else {
          VE.pruneOrphanTimelineSegments();
        }

        if (loadingOverlay) {
          loadingOverlay.style.display = 'none';
        }
        VE._endOverlayFocusTrap();

        return response.project;
      } else {
        throw new Error(response?.message || 'Project not found');
      }
    } catch (error) {
      console.error('Error loading project:', error);
      if (loadingOverlay) {
        loadingOverlay.style.display = 'none';
      }
      VE._endOverlayFocusTrap();
      VE.showProjectLoadError(error.message || 'This project could not be loaded.');
      return null;
    }
  };

  // ============================================
  // Project Title Editing
  // ============================================
  VE.updateProjectTitle = async function(newTitle) {
    if (!VE.projectState.currentProjectId) {
      console.warn('No project ID available to update title');
      return false;
    }
    
    try {
      const response = await window.apiService.request(`/projects/${VE.projectState.currentProjectId}`, {
        method: 'PUT',
        body: JSON.stringify({ title: newTitle || 'Untitled' })
      });
      
      if (response && response.success && response.project) {
        VE.projectState.currentProject = response.project;
        document.title = `${response.project.title || 'Untitled'} - Video Editor`;
        
        // Update detail panel if it exists
        const detailProjectName = document.getElementById('detail-project-name');
        if (detailProjectName) {
          detailProjectName.textContent = response.project.title || 'Untitled';
        }
        
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error updating project title:', error);
      return false;
    }
  };

  VE.setupProjectTitleEditing = function() {
    const projectTitle = document.getElementById('project-title');
    const projectNameInput = document.getElementById('project-name-input');
    const projectTitleContainer = document.querySelector('.project-title-input');
    
    if (!projectTitle || !projectNameInput) {
      console.warn('Project title editing elements not found');
      return;
    }
    
    // Click to edit - handle clicks on container (including icon) or title
    const startEditing = (e) => {
      e.stopPropagation();
      // Don't start editing if already editing (input is visible)
      if (projectNameInput.style.display === 'block' || projectNameInput.style.display === 'inline-block') {
        return;
      }
      
      const currentTitle = projectTitle.textContent || 'Untitled Project';
      
      // Hide display, show input
      projectTitle.style.display = 'none';
      projectNameInput.style.display = 'block';
      projectNameInput.value = currentTitle;
      projectNameInput.focus();
      projectNameInput.select();
    };
    
    // Allow clicking on container or title to edit
    if (projectTitleContainer) {
      projectTitleContainer.addEventListener('click', startEditing);
      projectTitleContainer.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') {
          return;
        }
        if (projectNameInput.style.display === 'block' || projectNameInput.style.display === 'inline-block') {
          return;
        }
        e.preventDefault();
        startEditing(e);
      });
    } else {
      projectTitle.addEventListener('click', startEditing);
    }
    
    // Save on Enter or Escape
    projectNameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        projectNameInput.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        // Cancel editing - restore original value
        const originalTitle = projectTitle.textContent || 'Untitled Project';
        projectNameInput.value = originalTitle;
        projectNameInput.blur();
      }
    });
    
    // Save on blur
    projectNameInput.addEventListener('blur', async () => {
      const newTitle = projectNameInput.value.trim() || 'Untitled Project';
      const originalTitle = projectTitle.textContent || 'Untitled Project';
      
      // Hide input, show display
      projectNameInput.style.display = 'none';
      projectTitle.style.display = 'inline';
      
      // Only save if title changed
      if (newTitle !== originalTitle) {
        // Show loading state
        projectTitle.textContent = 'Saving...';
        
        const success = await VE.updateProjectTitle(newTitle);
        
        if (success) {
          // Update displayed title on success
          projectTitle.textContent = newTitle;
          
          // Update detail panel
          const detailProjectName = document.getElementById('detail-project-name');
          if (detailProjectName) {
            detailProjectName.textContent = newTitle;
          }
        } else {
          // Restore original title on error
          projectTitle.textContent = originalTitle;
          if (typeof VE.showToast === 'function') {
            VE.showToast('error', 'Error', 'Failed to save project title');
          }
        }
      }
    });
  };

  // ============================================
  // Project Videos
  // ============================================
  VE.loadProjectVideos = async function(projectId) {
    if (!projectId) return;

    try {
      const response = await window.apiService.request(`/projects/${projectId}/assets`);

      if (response && response.success) {
        const projectUploads = response.uploads || [];
        VE.state.assets = [];

        for (const upload of projectUploads) {
          const asset = await VE.createAssetFromUpload(upload, true);
          if (asset) {
            VE.state.assets.push(asset);
          }
        }

        if (typeof VE.renderAssetGrid === 'function') {
          VE.renderAssetGrid();
        }

        if (VE.state.assets.length === 0) {
          if (VE.elements && VE.elements.uploadZone) VE.elements.uploadZone.style.display = 'flex';
          if (VE.elements && VE.elements.assetGrid) VE.elements.assetGrid.classList.remove('visible');
        } else {
          if (VE.elements && VE.elements.uploadZone) VE.elements.uploadZone.style.display = 'none';
          if (VE.elements && VE.elements.assetGrid) VE.elements.assetGrid.classList.add('visible');
        }
      }
    } catch (error) {
      console.error('Error loading project assets:', error);
      if (VE.elements && VE.elements.uploadZone) {
        VE.elements.uploadZone.style.display = 'flex';
      }
    }
  };

  VE.createAssetFromUpload = async function(upload, isProjectAsset = true) {
    try {
      const metadata = upload.metadata || {};
      const mediaType = metadata.media_type || 'video';
      const previewUrl = upload.preview_url || upload.download_url;
      
      const asset = {
        id: upload.id,
        name: upload.original_filename || 'Uploaded File',
        type: mediaType,
        file: null,
        objectUrl: previewUrl,
        isRemote: true,
        isProjectAsset: isProjectAsset,
        uploadId: upload.id,
        size: upload.file_size || 0,
        duration: 0,
        width: 0,
        height: 0,
        thumbnail: null
      };
      
      // Prefer backend-provided thumbnail URL if available (generated at upload time)
      const thumbUrl = metadata.thumbnail_url || metadata.thumbnailUrl;
      if (thumbUrl) {
        asset.thumbnail = thumbUrl;
      }
      
      // Try to get video/image metadata
      if (mediaType === 'video' && previewUrl) {
        try {
          const tempVideo = document.createElement('video');
          tempVideo.preload = 'auto';
          tempVideo.src = previewUrl;
          
          // Load metadata and generate thumbnail
          await new Promise((resolve) => {
            const timeout = setTimeout(() => {
              console.warn('Video metadata load timeout for:', previewUrl);
              // Set default values on timeout
              asset.duration = 5;
              asset.width = 1920;
              asset.height = 1080;
              resolve();
            }, 8000);
            
            tempVideo.onloadedmetadata = () => {
              asset.duration = tempVideo.duration || 5;
              asset.width = tempVideo.videoWidth || 1920;
              asset.height = tempVideo.videoHeight || 1080;
              
              // Seek to generate thumbnail
              tempVideo.currentTime = 0.1;
            };
            
            tempVideo.onseeked = () => {
              clearTimeout(timeout);
              try {
                // Generate thumbnail from video frame
                const canvas = document.createElement('canvas');
                canvas.width = 160;
                canvas.height = 90;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(tempVideo, 0, 0, canvas.width, canvas.height);
                asset.thumbnail = canvas.toDataURL('image/jpeg', 0.7);
              } catch (thumbErr) {
                console.warn('Thumbnail generation failed (CORS?):', thumbErr);
              }
              resolve();
            };
            
            tempVideo.onerror = (e) => {
              clearTimeout(timeout);
              console.error('❌ Video metadata load error:', e, tempVideo.error);
              if (tempVideo.error) {
                const errorCodes = {
                  1: 'MEDIA_ERR_ABORTED',
                  2: 'MEDIA_ERR_NETWORK',
                  3: 'MEDIA_ERR_DECODE', 
                  4: 'MEDIA_ERR_SRC_NOT_SUPPORTED'
                };
                console.error('Video error code:', tempVideo.error.code, '=', errorCodes[tempVideo.error.code] || 'Unknown');
                console.error('Video error message:', tempVideo.error.message);
              }
              // Set default values on error so the asset is still added
              asset.duration = 5;
              asset.width = 1920;
              asset.height = 1080;
              resolve();
            };
          });
        } catch (e) {
          console.warn('Error loading video metadata:', e);
        }
      } else if (mediaType === 'image' && previewUrl) {
        asset.duration = 5;
        asset.thumbnail = previewUrl;
      } else if (mediaType === 'audio' && previewUrl) {
        try {
          const tempAudio = document.createElement('audio');
          tempAudio.preload = 'metadata';
          tempAudio.src = previewUrl;
          
          await new Promise((resolve) => {
            const timeout = setTimeout(resolve, 5000);
            tempAudio.onloadedmetadata = () => {
              clearTimeout(timeout);
              asset.duration = tempAudio.duration || 0;
              resolve();
            };
            tempAudio.onerror = () => {
              clearTimeout(timeout);
              resolve();
            };
          });
        } catch (e) {
          console.warn('Error loading audio metadata:', e);
        }
      }
      
      return asset;
    } catch (error) {
      console.error('Error creating asset from upload:', error);
      return null;
    }
  };

  // ============================================
  // Save Upload to Project
  // ============================================
  VE.saveUploadToProject = async function(file, objectUrl, metadata = {}) {
    if (!VE.projectState.currentProjectId) {
      console.warn('No project open, upload will be local only');
      return null;
    }
    
    try {
      const formData = new FormData();
      formData.append('files', file);
      
      // If we have a pre-generated thumbnail data URL from the local file,
      // convert it to a Blob and send it alongside the video. The backend
      // will store it and expose a stable thumbnail_url in metadata.
      if (metadata.thumbnailDataUrl) {
        try {
          const blob = (function(dataUrl) {
            const parts = dataUrl.split(',');
            if (parts.length !== 2) return null;
            const meta = parts[0];
            const base64 = parts[1];
            const mimeMatch = meta.match(/data:(.*?);base64/);
            const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
            const binary = atob(base64);
            const len = binary.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
              bytes[i] = binary.charCodeAt(i);
            }
            return new Blob([bytes], { type: mime });
          })(metadata.thumbnailDataUrl);
          
          if (blob) {
            formData.append('thumbnail', blob, 'thumbnail.jpg');
          }
        } catch (e) {
          console.warn('Failed to attach thumbnail to upload:', e);
        }
      }
      
      const response = await fetch(`/api/projects/${VE.projectState.currentProjectId}/upload`, {
        method: 'POST',
        body: formData
      });
      
      const result = await response.json();
      
      if (result.success && result.uploads && result.uploads.length > 0) {
        const upload = result.uploads[0];
        console.log('Upload saved to project:', upload.id);
        return upload;
      } else {
        throw new Error(result.message || 'Upload failed');
      }
    } catch (error) {
      console.error('Error saving upload to project:', error);
      VE.showToast('error', 'Upload Error', 'Failed to save to project');
      return null;
    }
  };

  // ============================================
  // Save Progress
  // ============================================
  VE.saveProgress = async function() {
    if (!VE.projectState.currentProjectId) {
      return false;
    }
    
    try {
      // Serialize all progress data
      const progressData = {
        // Timeline segments (video clips, text frames, and image frames)
        timeline: VE.state.timeline.map(segment => ({
          id: segment.id,
          assetId: segment.assetId,
          name: segment.name,
          type: segment.type,
          startOffset: segment.startOffset,
          endOffset: segment.endOffset,
          originalDuration: segment.originalDuration,
          colorIndex: segment.colorIndex,
          thumbnail: segment.thumbnail,
          // Text frame data
          text: segment.text,
          font: segment.font,
          fontSize: segment.fontSize,
          color: segment.color,
          bgColor: segment.bgColor,
          // Image frame data (uses assetId above)
          // Transform data (crop, position, scale)
          transform: segment.transform,
          crop: segment.crop,
          // Audio detachment flag
          audioDetached: segment.audioDetached
        })),
        
        // Detached audio timeline
        detachedAudioTimeline: VE.state.detachedAudioTimeline.map(segment => ({
          id: segment.id,
          assetId: segment.assetId,
          name: segment.name,
          startOffset: segment.startOffset,
          endOffset: segment.endOffset,
          originalDuration: segment.originalDuration,
          timelineStart: segment.timelineStart,
          volume: segment.volume,
          colorIndex: segment.colorIndex,
          thumbnail: segment.thumbnail
        })),
        
        // Custom audio timeline
        customAudioTimeline: VE.state.customAudioTimeline.map(segment => ({
          id: segment.id,
          assetId: segment.assetId,
          name: segment.name,
          startOffset: segment.startOffset,
          endOffset: segment.endOffset,
          originalDuration: segment.originalDuration,
          timelineStart: segment.timelineStart,
          volume: segment.volume,
          colorIndex: segment.colorIndex,
          thumbnail: segment.thumbnail
        })),
        
        // Project settings
        projectResolution: VE.state.projectResolution,
        zoomLevel: VE.state.zoomLevel,
        
        // Filter settings
        activeFilterPreset: VE.state.activeFilterPreset,
        filters: VE.state.filters,
        
        // Audio track mute states
        isDetachedAudioMuted: VE.state.isDetachedAudioMuted,
        isCustomAudioMuted: VE.state.isCustomAudioMuted
      };
      
      const response = await window.apiService.request(
        `/projects/${VE.projectState.currentProjectId}`,
        {
          method: 'PUT',
          body: JSON.stringify({ progress_data: progressData })
        }
      );
      
      if (response && response.success) {
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error saving progress:', error);
      return false;
    }
  };

  // ============================================
  // Load Progress
  // ============================================
  VE.loadProgress = function(progressData) {
    if (!progressData) {
      return;
    }
    
    try {
      // Restore timeline
      if (progressData.timeline && Array.isArray(progressData.timeline)) {
        VE.state.timeline = progressData.timeline.map(segment => ({
          ...segment,
          // Ensure all required fields exist
          startOffset: segment.startOffset || 0,
          endOffset: segment.endOffset || segment.originalDuration || 0,
          originalDuration: segment.originalDuration || (segment.endOffset - segment.startOffset) || 0
        }));
      }
      
      // Restore detached audio timeline
      if (progressData.detachedAudioTimeline && Array.isArray(progressData.detachedAudioTimeline)) {
        VE.state.detachedAudioTimeline = progressData.detachedAudioTimeline.map(segment => ({
          ...segment,
          timelineStart: segment.timelineStart || 0,
          volume: segment.volume || 1.0
        }));
      }
      
      // Restore custom audio timeline
      if (progressData.customAudioTimeline && Array.isArray(progressData.customAudioTimeline)) {
        VE.state.customAudioTimeline = progressData.customAudioTimeline.map(segment => ({
          ...segment,
          timelineStart: segment.timelineStart || 0,
          volume: segment.volume || 1.0
        }));
      }
      
      // Restore project settings
      if (progressData.projectResolution) {
        VE.state.projectResolution = progressData.projectResolution;
      }
      
      if (progressData.zoomLevel !== undefined) {
        VE.state.zoomLevel = progressData.zoomLevel;
        if (typeof VE.setZoom === 'function') {
          VE.setZoom(progressData.zoomLevel);
        }
      }
      
      // Restore filter settings
      if (progressData.activeFilterPreset) {
        VE.state.activeFilterPreset = progressData.activeFilterPreset;
      }
      
      if (progressData.filters) {
        VE.state.filters = { ...VE.state.filters, ...progressData.filters };
      }
      
      // Restore audio mute states
      if (progressData.isDetachedAudioMuted !== undefined) {
        VE.state.isDetachedAudioMuted = progressData.isDetachedAudioMuted;
      }
      
      if (progressData.isCustomAudioMuted !== undefined) {
        VE.state.isCustomAudioMuted = progressData.isCustomAudioMuted;
      }
      
      // Update total duration
      if (typeof VE.updateTotalDuration === 'function') {
        VE.updateTotalDuration();
      }
      
      // Update audio duration
      if (typeof VE.updateAudioDuration === 'function') {
        VE.updateAudioDuration();
      }
      
      // Re-render timeline
      if (typeof VE.renderTimeline === 'function') {
        VE.renderTimeline();
      }
      
      // Apply filters if needed
      if (typeof VE.applyFilters === 'function') {
        VE.applyFilters();
      }
      
      // Load preview video from first timeline segment if available
      if (VE.state.timeline && VE.state.timeline.length > 0) {
        const firstSegment = VE.state.timeline[0];
        const asset = VE.state.assets.find(a => a.id === firstSegment.assetId);
        if (asset && asset.type === 'video') {
          // Wait a bit to ensure assets are fully loaded
          setTimeout(() => {
            if (typeof VE.loadVideoToPreview === 'function') {
              VE.loadVideoToPreview(asset, firstSegment);
            }
          }, 100);
        }
      } else if (VE.state.assets.length > 0) {
        // If no timeline but there are assets, load the first video asset
        const firstVideoAsset = VE.state.assets.find(a => a.type === 'video');
        if (firstVideoAsset) {
          setTimeout(() => {
            if (typeof VE.loadVideoToPreview === 'function') {
              VE.loadVideoToPreview(firstVideoAsset);
            }
          }, 100);
        }
      }
      
    } catch (error) {
      console.error('Error loading progress:', error);
    }
  };

  // ============================================
  // Auto-save with debouncing
  // ============================================
  let saveProgressTimeout = null;
  const SAVE_DELAY = 2000; // 2 seconds debounce
  
  VE.scheduleProgressSave = function() {
    if (!VE.projectState.currentProjectId) {
      return;
    }
    
    // Clear existing timeout
    if (saveProgressTimeout) {
      clearTimeout(saveProgressTimeout);
    }
    
    VE.updateSaveStatus('saving');
    saveProgressTimeout = setTimeout(async function() {
      saveProgressTimeout = null;
      const ok = await VE.saveProgress();
      VE.updateSaveStatus(ok ? 'saved' : 'error');
    }, SAVE_DELAY);
  };

  // ============================================
  // Initialization
  // ============================================
  VE.initProjects = function() {
    VE.setupProjectErrorOverlay();
    VE.setupProjectTitleEditing();

    const projectId = VE.getProjectIdFromUrl();

    if (projectId) {
      const loadWhenReady = () => {
        if (window.apiService && typeof window.apiService.request === 'function') {
          VE.loadProject(projectId);
        } else {
          setTimeout(loadWhenReady, 100);
        }
      };
      setTimeout(loadWhenReady, 200);
      return;
    }

    (async () => {
      try {
        const res = await window.apiService.request('/projects', {
          method: 'POST',
          body: JSON.stringify({ title: 'Untitled' })
        });
        if (res && res.success && res.project && res.project.id) {
          window.location.replace('/p/' + res.project.id);
          return;
        }
      } catch (e) {
        console.error(e);
      }
      if (typeof VE.showToast === 'function') {
        VE.showToast('error', 'Error', 'Could not start editor');
      }
    })();
  };

})();
