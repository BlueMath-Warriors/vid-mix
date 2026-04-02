/**
 * Video Lab Editor - Assets Module
 * Upload handling, asset grid management, library import
 */

(function() {
  'use strict';
  
  const VE = window.VideoEditor = window.VideoEditor || {};

  // Library videos cache
  VE.libraryVideos = [];
  VE.libraryLoaded = false;
  
  // Upload state tracking
  VE.uploadingAssets = []; // Track assets currently being uploaded

  // ============================================
  // Upload Functions
  // ============================================
  function _inferKindFromFilename(name) {
    if (!name || typeof name !== 'string') {
      return null;
    }
    const ext = (name.split('.').pop() || '').toLowerCase();
    const videoExt = 'mp4,webm,mov,mkv,avi,m4v,ogv,mpeg,mpg,3gp'.split(',');
    const imageExt = 'png,jpg,jpeg,gif,webp,bmp,svg,ico'.split(',');
    const audioExt = 'mp3,wav,ogg,aac,m4a,flac,opus,wma'.split(',');
    if (videoExt.indexOf(ext) >= 0) return 'video';
    if (imageExt.indexOf(ext) >= 0) return 'image';
    if (audioExt.indexOf(ext) >= 0) return 'audio';
    return null;
  }

  VE.handleFiles = function(files) {
    const maxSize = 200 * 1024 * 1024;

    Array.from(files).forEach(async (file) => {
      const inferred = _inferKindFromFilename(file.name);
      const typeOk = file.type && (
        file.type.startsWith('video/') ||
        file.type.startsWith('image/') ||
        file.type.startsWith('audio/')
      );
      if (!typeOk && !inferred) {
        VE.showToast('error', 'Invalid File', 'Please upload a video, image, or audio file');
        return;
      }

      if (file.size > maxSize) {
        VE.showToast('warning', 'File Too Large', `${file.name} exceeds 200MB limit`);
        return;
      }

      // Generate a placeholder ID for this upload
      const placeholderId = VE.generateId();
      const fileType = typeOk ? file.type.split('/')[0] : inferred;
      
      // Add placeholder asset to show loading state
      const placeholderAsset = {
        id: placeholderId,
        name: file.name,
        type: fileType,
        isUploading: true, // Mark as uploading
        uploadProgress: 0
      };
      VE.uploadingAssets.push(placeholderAsset);
      VE.renderAssetGrid(); // Re-render to show placeholder with loader

      const objectUrl = URL.createObjectURL(file);
      const asset = {
        id: placeholderId, // Use same ID as placeholder
        name: file.name,
        type: fileType,
        file: file,
        objectUrl: objectUrl,
        size: file.size,
        duration: 0,
        width: 0,
        height: 0,
        thumbnail: null,
        isLocalUpload: true // Mark as local until saved to project
      };

      // Helper function to finalize asset and save to project
      const finalizeAsset = async (asset) => {
        // Keep placeholder visible during server upload
        // Don't remove from uploadingAssets yet - wait until server upload completes
        // Don't add to VE.state.assets yet either - we'll add it after upload completes
        
        // Save to project if one is open
        if (VE.projectState && VE.projectState.currentProjectId) {
          try {
            const savedUpload = await VE.saveUploadToProject(file, objectUrl, {
              mediaType: asset.type,
              // Pass along the locally-generated thumbnail so backend can persist it
              thumbnailDataUrl: asset.thumbnail
            });
            
            // Now remove the placeholder - server upload is complete
            VE.uploadingAssets = VE.uploadingAssets.filter(a => a.id !== asset.id);
            
            if (savedUpload) {
              // Update asset with server info
              asset.uploadId = savedUpload.id;
              asset.isLocalUpload = false;
              asset.isProjectAsset = true;
              
              // Update objectUrl to use server URL if available
              if (savedUpload.preview_url) {
                asset.serverUrl = savedUpload.preview_url;
              }
              
              // If audio file, add to uploadedAudioFiles array for audio tab
              if (asset.type === 'audio') {
                const audioUrl = savedUpload.preview_url || savedUpload.download_url || asset.objectUrl;
                const metadata = savedUpload.metadata || {};
                
                // Initialize uploadedAudioFiles array if it doesn't exist
                if (!VE.uploadedAudioFiles) {
                  VE.uploadedAudioFiles = [];
                }
                
                // Check if already exists (shouldn't happen, but just in case)
                const existingIndex = VE.uploadedAudioFiles.findIndex(a => a.id === savedUpload.id);
                if (existingIndex === -1) {
                  VE.uploadedAudioFiles.unshift({
                    id: savedUpload.id,
                    name: savedUpload.original_filename || asset.name || 'Uploaded Audio',
                    audio_url: audioUrl,
                    duration: asset.duration || metadata.duration || metadata.duration_seconds || 0,
                    created_at: new Date().toISOString(),
                    isInCurrentProject: true
                  });
                  
                  // Re-render audio grid if audio panel is active
                  const audioPanel = document.getElementById('audio-panel');
                  if (audioPanel && audioPanel.classList.contains('active')) {
                    VE.renderAudioGrid();
                  }
                }
              }
            }
            
            // Add asset to state and render grid (placeholder is already removed)
            VE.state.assets.push(asset);
            VE.renderAssetGrid();
            
            // Update library's "in project" status
            if (typeof VE.updateLibraryProjectStatus === 'function') {
              VE.updateLibraryProjectStatus();
            }

            // Auto-save progress so new assets are reflected in project data
            if (typeof VE.scheduleProgressSave === 'function') {
              VE.scheduleProgressSave();
            }
          } catch (error) {
            // Remove placeholder even on error
            VE.uploadingAssets = VE.uploadingAssets.filter(a => a.id !== asset.id);
            // Still add asset locally even if server upload failed
            VE.state.assets.push(asset);
            VE.renderAssetGrid();
            console.error('Error during server upload:', error);
          }
        } else {
          // No project open, just remove placeholder and add asset locally
          VE.uploadingAssets = VE.uploadingAssets.filter(a => a.id !== asset.id);
          VE.state.assets.push(asset);
          VE.renderAssetGrid();
        }
      };

      // Helper function to remove placeholder on error
      const removePlaceholder = (assetId) => {
        VE.uploadingAssets = VE.uploadingAssets.filter(a => a.id !== assetId);
        VE.renderAssetGrid();
      };

      if (fileType === 'video') {
        const tempVideo = document.createElement('video');
        tempVideo.preload = 'metadata';
        tempVideo.src = objectUrl;
        
        tempVideo.onerror = () => {
          removePlaceholder(placeholderId);
          VE.showToast('error', 'Failed to load', file.name);
        };
        
        tempVideo.onloadedmetadata = () => {
          asset.duration = tempVideo.duration;
          asset.width = tempVideo.videoWidth;
          asset.height = tempVideo.videoHeight;
          tempVideo.currentTime = 0.1;
        };

        tempVideo.onseeked = async () => {
          const canvas = document.createElement('canvas');
          canvas.width = 160;
          canvas.height = 90;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(tempVideo, 0, 0, canvas.width, canvas.height);
          asset.thumbnail = canvas.toDataURL('image/jpeg', 0.7);

          await finalizeAsset(asset);
          
          if (VE.state.assets.length === 1) {
            VE.loadVideoToPreview(asset);
          }

          VE.showToast('success', 'Video Added', file.name);
        };
      } else if (fileType === 'image') {
        const img = new Image();
        img.onerror = () => {
          removePlaceholder(placeholderId);
          VE.showToast('error', 'Failed to load', file.name);
        };
        img.onload = async () => {
          asset.width = img.width;
          asset.height = img.height;
          asset.duration = 5; // Default 5 seconds for images
          asset.thumbnail = objectUrl;
          
          await finalizeAsset(asset);
          VE.showToast('success', 'Image Added', file.name);
        };
        img.src = objectUrl;
      } else if (fileType === 'audio') {
        const tempAudio = document.createElement('audio');
        tempAudio.preload = 'metadata';
        tempAudio.src = objectUrl;
        
        tempAudio.onerror = () => {
          removePlaceholder(placeholderId);
          VE.showToast('error', 'Failed to load', file.name);
        };
        
        tempAudio.onloadedmetadata = async () => {
          asset.duration = tempAudio.duration;
          // Generate waveform thumbnail
          try {
            asset.thumbnail = await VE.generateAudioWaveform(file, objectUrl);
          } catch (e) {
            // Fallback: simple audio icon thumbnail
            asset.thumbnail = null;
          }
          
          await finalizeAsset(asset);
          VE.showToast('success', 'Audio Added', file.name);
        };
      }
    });

    if (files.length > 0) {
      if (VE.elements.uploadZone) {
        VE.elements.uploadZone.style.display = 'none';
      }
      if (VE.elements.assetGrid) {
        VE.elements.assetGrid.classList.add('visible');
      }
      
      // Pre-load FFmpeg in the background after first upload (lazy loading)
      // This way FFmpeg is ready when user wants to export, without blocking initial load
      if (!VE.state.ffmpegLoaded && !VE.state.ffmpegLoading) {
        VE.state.ffmpegLoading = true;
        // Delay pre-loading by 2 seconds to not compete with asset processing
        setTimeout(() => {
          console.log('Pre-loading FFmpeg in background...');
          VE.loadFFmpeg().then(loaded => {
            if (loaded) {
              console.log('FFmpeg pre-loaded successfully');
            }
          }).catch(err => {
            console.warn('FFmpeg pre-load failed (will retry on export):', err);
            VE.state.ffmpegLoading = false;
          });
        }, 2000);
      }
    }
  };

  VE.setupUploadHandlers = function() {
    const zone = VE.elements.uploadZone;
    const input = VE.elements.fileInput;
    const chooseBtn = document.getElementById('import-choose-files-btn');

    if (!zone || !input) {
      console.error('Upload zone or file input not found');
      return;
    }

    if (chooseBtn) {
      chooseBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        input.click();
      });
    }

    // Click on upload zone to trigger file input
    zone.addEventListener('click', (e) => {
      // Don't trigger if clicking on child elements that have their own handlers
      if (e.target.closest('.import-file-btn') || e.target.closest('#import-choose-files-btn')) {
        return;
      }
      // Trigger file input when clicking anywhere on the dropzone
      input.click();
    });

    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.style.borderColor = 'var(--brand-primary)';
    });

    zone.addEventListener('dragleave', () => {
      zone.style.borderColor = '';
    });

    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.style.borderColor = '';
      VE.handleFiles(e.dataTransfer.files);
    });

    input.addEventListener('change', () => {
      if (input.files.length > 0) {
        VE.handleFiles(input.files);
        input.value = '';
      }
    });
  };

  // ============================================
  // Asset Grid
  // ============================================
  VE.renderAssetGrid = function() {
    VE.elements.assetGrid.innerHTML = '';

    // Only show project assets (assets associated with the current project)
    // Use truthy check instead of strict === true to catch any truthy values
    const projectAssets = VE.state.assets.filter(asset => asset.isProjectAsset === true);
    
    // Check if any uploads are in progress
    const isUploading = VE.uploadingAssets && VE.uploadingAssets.length > 0;

    // Always show Project Assets section header (even if empty, to show upload button)
    const sectionHeader = document.createElement('div');
    sectionHeader.className = 'asset-section-header';
    sectionHeader.style.cssText = 'grid-column: 1 / -1; padding: 12px 8px 8px; font-size: 12px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid var(--border-light); margin-bottom: 8px;';
    sectionHeader.innerHTML = '<i class="fas fa-folder-open" style="margin-right: 6px;"></i> Project Assets';
    VE.elements.assetGrid.appendChild(sectionHeader);

    // Add import button as first item in Project Assets section
    // Lock the button when uploads are in progress
    const addBtn = document.createElement('div');
    addBtn.className = `asset-item add-asset-btn${isUploading ? ' uploading-locked' : ''}`;
    if (isUploading) {
      addBtn.style.cssText = 'display:flex;align-items:center;justify-content:center;cursor:not-allowed;opacity:0.5;pointer-events:none;';
      addBtn.innerHTML = '<i class="fas fa-lock" style="font-size:20px;color:var(--text-muted);"></i>';
      addBtn.title = 'Upload in progress...';
    } else {
      addBtn.style.cssText = 'display:flex;align-items:center;justify-content:center;cursor:pointer;';
      addBtn.innerHTML = '<i class="fas fa-plus" style="font-size:24px;color:var(--text-muted);"></i>';
      addBtn.addEventListener('click', () => VE.elements.fileInput.click());
    }
    VE.elements.assetGrid.appendChild(addBtn);

    // Render placeholder cards for assets being uploaded
    if (VE.uploadingAssets && VE.uploadingAssets.length > 0) {
      VE.uploadingAssets.forEach(placeholder => {
        const item = VE.createUploadingPlaceholder(placeholder);
        VE.elements.assetGrid.appendChild(item);
      });
    }

    // Render project assets
    projectAssets.forEach(asset => {
      const item = VE.createAssetItem(asset);
      VE.elements.assetGrid.appendChild(item);
    });

    // Show empty state message if no project assets and no uploading assets
    if (projectAssets.length === 0 && (!VE.uploadingAssets || VE.uploadingAssets.length === 0)) {
      const emptyMsg = document.createElement('div');
      emptyMsg.className = 'asset-empty-message';
      emptyMsg.style.cssText = 'grid-column: 1 / -1; padding: 20px; text-align: center; color: var(--text-muted); font-size: 13px;';
      emptyMsg.innerHTML = '<p>No assets in this project yet.</p><p class="asset-empty-hint">Use the + tile or <strong>Choose files</strong> in the import area to add media.</p>';
      VE.elements.assetGrid.appendChild(emptyMsg);
    }
  };

  // Create a placeholder item for an asset being uploaded
  VE.createUploadingPlaceholder = function(placeholder) {
    const item = document.createElement('div');
    const isAudio = placeholder.type === 'audio';
    const isImage = placeholder.type === 'image';
    item.className = `asset-item uploading-placeholder ${isAudio ? 'audio-asset' : ''}`;
    item.dataset.placeholderId = placeholder.id;
    
    // Determine icon based on type
    let typeIcon = 'fa-film'; // video
    if (isAudio) typeIcon = 'fa-music';
    if (isImage) typeIcon = 'fa-image';
    
    item.innerHTML = `
      <div class="uploading-overlay">
        <div class="uploading-spinner">
          <i class="fas fa-spinner fa-spin"></i>
        </div>
        <div class="uploading-info">
          <i class="fas ${typeIcon}"></i>
          <span class="uploading-text">Uploading...</span>
        </div>
      </div>
    `;
    
    return item;
  };

  // Helper function to create an asset item
  VE.createAssetItem = function(asset, isAlreadyInProject = false) {
    const item = document.createElement('div');
    const isAudio = asset.type === 'audio';
    item.className = `asset-item ${VE.state.currentAsset?.id === asset.id ? 'selected' : ''} ${isAudio ? 'audio-asset' : ''} ${isAlreadyInProject ? 'already-included' : ''}`;
    
    let thumbnailHtml;
    if (asset.thumbnail) {
      thumbnailHtml = `<img src="${asset.thumbnail}" alt="${asset.name}">`;
    } else if (isAudio) {
      thumbnailHtml = `<div class="audio-placeholder"><i class="fas fa-music"></i></div>`;
    } else if (asset.type === 'video' && asset.objectUrl) {
      // For videos without a generated thumbnail, use a small video preview
      // instead of a static placeholder. This avoids cross-origin canvas issues
      // with GCS while still giving the user a visual cue.
      thumbnailHtml = `
        <div class="video-thumb-wrapper">
          <video src="${asset.objectUrl}" muted preload="metadata"
                 onloadeddata="this.currentTime=0.5;"
                 onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
          </video>
          <div class="video-placeholder" style="display:none;"><i class="fas fa-film"></i></div>
        </div>`;
    } else if (asset.type === 'image' && asset.objectUrl) {
      // Use the image itself as thumbnail
      thumbnailHtml = `<img src="${asset.objectUrl}" alt="${asset.name}">`;
    } else {
      thumbnailHtml = `<div class="video-placeholder"><i class="fas fa-file"></i></div>`;
    }
    
    // Add "Already Included" badge if this asset is in project assets
    const includedBadge = isAlreadyInProject 
      ? '<span class="included-badge" title="Already in Project Assets"><i class="fas fa-check-circle"></i></span>'
      : '';
    
    // Add processing indicator for videos that are still generating
    const isProcessing = asset.status === 'processing' || asset.status === 'queued' || asset.status === 'running';
    const processingBadge = isProcessing
      ? '<div class="asset-processing-overlay"><i class="fas fa-spinner fa-spin"></i><span>Generating...</span></div>'
      : '';
    
    item.innerHTML = `
      ${thumbnailHtml}
      ${processingBadge}
      <span class="duration">${VE.formatTimeShort(asset.duration)}</span>
      ${isAudio ? '<span class="asset-type-badge"><i class="fas fa-music"></i></span>' : ''}
      ${includedBadge}
      <button class="remove-btn"><i class="fas fa-times"></i></button>
    `;

    item.addEventListener('click', (e) => {
      if (!e.target.closest('.remove-btn')) {
        if (asset.type === 'video') {
          VE.loadVideoToPreview(asset);
        }
        // Double click to add to timeline
        if (e.detail === 2) {
          if (asset.type === 'audio') {
            VE.addAudioToTimeline(asset);
          } else {
            VE.addToTimeline(asset);
          }
        }
        VE.renderAssetGrid();
      }
    });

    item.querySelector('.remove-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      VE.removeAsset(asset.id);
    });

    return item;
  };

  VE.removeAsset = async function(assetId) {
    const asset = VE.state.assets.find(a => a.id === assetId);
    if (asset) {
      // Remove from backend if it's a project asset (without deleting from library)
      if (asset.isProjectAsset && VE.projectState?.currentProjectId) {
        try {
          if (asset.uploadId) {
            const response = await window.apiService.request(
              `/projects/${VE.projectState.currentProjectId}/uploads/${asset.uploadId}`,
              { method: 'DELETE' }
            );
            if (response && response.success) {
              console.log('Upload removed from project:', asset.uploadId);
            } else {
              console.warn('Failed to remove upload from project:', response?.message);
            }
          }
        } catch (error) {
          console.error('Error removing asset from project:', error);
          VE.showToast('warning', 'Warning', 'Asset removed locally but server removal failed');
        }
      }
      
      // Clean up object URL to prevent memory leaks
      URL.revokeObjectURL(asset.objectUrl);
      
      // Remove from video pool to free memory
      VE.videoPool.remove(assetId);
      
      // Clean up any audio elements from both timelines
      [...VE.state.detachedAudioTimeline, ...VE.state.customAudioTimeline]
        .filter(s => s.assetId === assetId)
        .forEach(s => {
          if (VE.state.audioElements.has(s.id)) {
            const audio = VE.state.audioElements.get(s.id);
            audio.pause();
            audio.src = '';
            VE.state.audioElements.delete(s.id);
          }
        });
      
      VE.state.assets = VE.state.assets.filter(a => a.id !== assetId);
      VE.state.timeline = VE.state.timeline.filter(s => s.assetId !== assetId);
      VE.state.detachedAudioTimeline = VE.state.detachedAudioTimeline.filter(s => s.assetId !== assetId);
      VE.state.customAudioTimeline = VE.state.customAudioTimeline.filter(s => s.assetId !== assetId);
      
      if (VE.state.currentAsset?.id === assetId) {
        VE.state.currentAsset = null;
        VE.elements.previewVideo.src = '';
        VE.elements.previewVideo.classList.remove('active');
        VE.elements.canvasPlaceholder.style.display = 'block';
      }

      VE.renderAssetGrid();
      VE.renderTimeline();
      VE.updateAudioDuration();

      if (VE.state.assets.length === 0) {
        VE.elements.uploadZone.style.display = 'flex';
        VE.elements.assetGrid.classList.remove('visible');
      }
      
      // Update library status to reflect that asset is no longer in project
      if (typeof VE.updateLibraryProjectStatus === 'function') {
        VE.updateLibraryProjectStatus();
      }
      
      // Update images library status
      if (typeof VE.updateImagesProjectStatus === 'function') {
        VE.updateImagesProjectStatus();
      }
      
      // Update audio library status
      if (asset.type === 'audio' && asset.uploadId && VE.uploadedAudioFiles) {
        const audioFile = VE.uploadedAudioFiles.find(a => a.id === asset.uploadId);
        if (audioFile) {
          // Get current project audio IDs to check if still in project
          const projectAssetIds = new Set(
            VE.state.assets.filter(a => a.isProjectAsset && a.type === 'audio').map(a => a.uploadId || a.id)
          );
          audioFile.isInCurrentProject = projectAssetIds.has(asset.uploadId);
          // Re-render audio grid if audio panel is active
          const audioPanel = document.getElementById('audio-panel');
          if (audioPanel && audioPanel.classList.contains('active')) {
            VE.renderAudioGrid();
          }
        }
      }
      
      VE.showToast('success', 'Removed', asset.name || 'Asset removed');
    }
  };

  // ============================================
  // Audio Waveform Generation
  // ============================================
  VE.generateAudioWaveform = function(file, objectUrl) {
    return new Promise((resolve, reject) => {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const reader = new FileReader();
      
      reader.onload = async (e) => {
        try {
          const audioBuffer = await audioContext.decodeAudioData(e.target.result);
          const canvas = document.createElement('canvas');
          canvas.width = 160;
          canvas.height = 90;
          const ctx = canvas.getContext('2d');
          
          // Draw background
          ctx.fillStyle = '#1a1a1a';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          
          // Get audio data
          const channelData = audioBuffer.getChannelData(0);
          const step = Math.ceil(channelData.length / canvas.width);
          
          // Draw waveform
          ctx.strokeStyle = '#22c55e';
          ctx.lineWidth = 2;
          ctx.beginPath();
          
          const centerY = canvas.height / 2;
          const amplitude = canvas.height * 0.35;
          
          for (let i = 0; i < canvas.width; i++) {
            let min = 1.0;
            let max = -1.0;
            
            for (let j = 0; j < step; j++) {
              const datum = channelData[(i * step) + j];
              if (datum < min) min = datum;
              if (datum > max) max = datum;
            }
            
            const yMin = centerY + (min * amplitude);
            const yMax = centerY + (max * amplitude);
            
            if (i === 0) {
              ctx.moveTo(i, yMin);
            }
            ctx.lineTo(i, yMin);
            ctx.lineTo(i, yMax);
          }
          
          ctx.stroke();
          
          // Draw center line
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, centerY);
          ctx.lineTo(canvas.width, centerY);
          ctx.stroke();
          
          // Add audio icon
          ctx.fillStyle = 'rgba(34, 197, 94, 0.8)';
          ctx.font = '16px FontAwesome';
          ctx.textAlign = 'center';
          ctx.fillText('♪', 12, 20);
          
          audioContext.close();
          resolve(canvas.toDataURL('image/jpeg', 0.8));
        } catch (err) {
          audioContext.close();
          reject(err);
        }
      };
      
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  };

  // ============================================
  // Add Audio to Timeline
  // ============================================
  VE.addAudioToTimeline = function(asset, startTime = null) {
    // Calculate start time - place at end of custom audio timeline or at specified time
    const audioTrackEnd = VE.state.customAudioTimeline.reduce(
      (sum, s) => Math.max(sum, s.timelineStart + (s.endOffset - s.startOffset)), 
      0
    );
    
    const segment = {
      id: VE.generateId(),
      assetId: asset.id,
      name: asset.name,
      type: 'audio',
      duration: asset.duration,
      startOffset: 0,
      endOffset: asset.duration,
      originalDuration: asset.duration,
      timelineStart: startTime !== null ? startTime : audioTrackEnd, // Position on timeline
      volume: 1.0,
      colorIndex: VE.state.customAudioTimeline.length % VE.audioColors.length,
      thumbnail: asset.thumbnail
    };

    // Add to CUSTOM audio timeline
    VE.state.customAudioTimeline.push(segment);
    VE.updateAudioDuration();
    VE.renderTimeline();
    VE.showToast('success', 'Added to Audio Track', asset.name);
    // Auto-save progress
    if (typeof VE.scheduleProgressSave === 'function') {
      VE.scheduleProgressSave();
    }
  };

  VE.updateAudioDuration = function() {
    // Get max duration from both audio timelines
    const detachedMax = VE.state.detachedAudioTimeline.reduce(
      (max, s) => Math.max(max, s.timelineStart + (s.endOffset - s.startOffset)), 
      0
    );
    const customMax = VE.state.customAudioTimeline.reduce(
      (max, s) => Math.max(max, s.timelineStart + (s.endOffset - s.startOffset)), 
      0
    );
    VE.state.audioDuration = Math.max(detachedMax, customMax);
  };

  // ============================================
  // Library Tab - My Videos
  // ============================================
  
  VE.setupLibraryTabHandlers = function() {
    const uploadedTab = document.getElementById('assets-tab-uploaded');
    const libraryTab = document.getElementById('assets-tab-library');
    const uploadedContent = document.getElementById('uploaded-content');
    const libraryContent = document.getElementById('library-content');
    
    if (!uploadedTab || !libraryTab) return;
    
    uploadedTab.addEventListener('click', () => {
      uploadedTab.classList.add('active');
      libraryTab.classList.remove('active');
      if (uploadedContent) uploadedContent.classList.add('active');
      if (libraryContent) libraryContent.classList.remove('active');
    });
    
    libraryTab.addEventListener('click', () => {
      libraryTab.classList.add('active');
      uploadedTab.classList.remove('active');
      if (libraryContent) libraryContent.classList.add('active');
      if (uploadedContent) uploadedContent.classList.remove('active');
      
      // Load library videos if not already loaded
      if (!VE.libraryLoaded) {
        VE.loadLibraryVideos();
      }
    });
  };

  // Cache for user uploads in library
  VE.libraryUserUploads = [];
  VE.userUploadsLoaded = false;
  VE.activeLibraryTab = 'ai-generated'; // Track active tab

  // Load AI generated videos
  VE.loadAIGeneratedVideos = async function() {
    const loadingEl = document.getElementById('library-loading');
    const emptyEl = document.getElementById('library-empty');
    const gridEl = document.getElementById('library-grid');

    if (!gridEl) return;

    if (loadingEl) loadingEl.style.display = 'flex';
    if (emptyEl) emptyEl.style.display = 'none';
    gridEl.innerHTML = '';

    VE.libraryVideos = [];
    VE.libraryLoaded = true;
    if (loadingEl) loadingEl.style.display = 'none';
    if (emptyEl) {
      const p = emptyEl.querySelector('p');
      const hint = emptyEl.querySelector('.hint');
      if (p) p.textContent = 'No cloud library';
      if (hint) hint.textContent = 'Import files under Project Assets.';
      emptyEl.style.display = 'flex';
    }
    VE.renderLibraryGrid();
  };

  // Load user uploads
  VE.loadUserUploads = async function() {
    const loadingEl = document.getElementById('library-loading');
    const emptyEl = document.getElementById('library-empty');
    const gridEl = document.getElementById('library-grid');

    if (!gridEl) return;

    if (loadingEl) loadingEl.style.display = 'flex';
    if (emptyEl) emptyEl.style.display = 'none';
    gridEl.innerHTML = '';

    VE.libraryUserUploads = [];
    VE.userUploadsLoaded = true;
    if (loadingEl) loadingEl.style.display = 'none';
    if (emptyEl) {
      const p = emptyEl.querySelector('p');
      const hint = emptyEl.querySelector('.hint');
      if (p) p.textContent = 'No shared uploads library';
      if (hint) hint.textContent = 'Use Project Assets for all media.';
      emptyEl.style.display = 'flex';
    }
    VE.renderLibraryGrid();
  };

  VE.loadLibraryVideos = async function() {
    /* Standalone editor: no cloud / AI library panel */
  };

  // ============================================
  // Audio Tab - Uploaded Audio Files
  // ============================================
  
  // Cache for uploaded audio files
  VE.uploadedAudioFiles = [];
  VE.audioLoaded = false;

  // Load uploaded audio files
  VE.loadUploadedAudio = async function() {
    const loadingEl = document.getElementById('audio-loading');
    const emptyEl = document.getElementById('audio-empty');
    const gridEl = document.getElementById('audio-grid');
    
    if (!gridEl) return;
    
    // Return if already loaded
    if (VE.audioLoaded && VE.uploadedAudioFiles.length > 0) {
      VE.renderAudioGrid();
      return;
    }
    
    // Show loading state
    if (loadingEl) loadingEl.style.display = 'flex';
    if (emptyEl) emptyEl.style.display = 'none';
    gridEl.innerHTML = '';
    
    try {
      if (!VE.projectState || !VE.projectState.currentProjectId) {
        VE.uploadedAudioFiles = [];
        VE.audioLoaded = true;
        if (loadingEl) loadingEl.style.display = 'none';
        if (emptyEl) {
          emptyEl.querySelector('p').textContent = 'No project open';
          emptyEl.style.display = 'flex';
        }
        VE.renderAudioGrid();
        return;
      }

      const response = await window.apiService.request(
        `/projects/${VE.projectState.currentProjectId}/assets`
      );

      VE.uploadedAudioFiles = [];

      const projectAssetIds = new Set(
        VE.state.assets.filter(a => a.isProjectAsset && a.type === 'audio').map(a => a.uploadId || a.id)
      );

      const uploads = (response && response.uploads) || [];
      uploads.forEach(u => {
        const meta = u.metadata || {};
        const mediaType = meta.media_type || u.media_type || '';
        if (mediaType !== 'audio') return;
        const audioUrl = u.preview_url || u.download_url;
        if (audioUrl) {
          VE.uploadedAudioFiles.push({
            id: u.id,
            name: u.original_filename || 'Uploaded Audio',
            audio_url: audioUrl,
            duration: meta.duration || meta.duration_seconds || 0,
            created_at: u.created_at || new Date().toISOString(),
            isInCurrentProject: projectAssetIds.has(u.id)
          });
        }
      });

      VE.uploadedAudioFiles.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      VE.audioLoaded = true;

      if (loadingEl) loadingEl.style.display = 'none';

      if (VE.uploadedAudioFiles.length === 0 && emptyEl) {
        emptyEl.querySelector('p').textContent = 'No uploaded audio files yet';
        emptyEl.style.display = 'flex';
      } else if (emptyEl) {
        emptyEl.style.display = 'none';
      }

      VE.renderAudioGrid();
    } catch (error) {
      console.error('Failed to load uploaded audio files:', error);
      if (loadingEl) loadingEl.style.display = 'none';
      if (emptyEl) {
        emptyEl.querySelector('p').textContent = 'Failed to load audio files';
        emptyEl.style.display = 'flex';
      }
    }
  };

  // Render audio grid
  VE.renderAudioGrid = function() {
    const gridEl = document.getElementById('audio-grid');
    const emptyEl = document.getElementById('audio-empty');
    
    if (!gridEl) return;
    
    const hasAudio = VE.uploadedAudioFiles.length > 0;
    
    // Show empty state if no audio files
    if (!hasAudio) {
      gridEl.innerHTML = '';
      gridEl.style.display = 'none';
      if (emptyEl) {
        emptyEl.style.display = 'flex';
      }
      return;
    }
    
    // Show grid, hide empty state
    gridEl.style.display = 'grid';
    if (emptyEl) emptyEl.style.display = 'none';
    
    let html = '';
    
    html += VE.uploadedAudioFiles.map(audio => {
      // Truncate name for display
      const title = audio.name && audio.name.length > 30 
        ? audio.name.substring(0, 30) + '...' 
        : (audio.name || 'Uploaded audio');
      
      const duration = typeof audio.duration === 'number' && audio.duration > 0
        ? VE.formatTimeShort(audio.duration)
        : '--';
      
      // Show badge if already in current project
      const inProjectBadge = audio.isInCurrentProject 
        ? '<span class="in-project-badge" title="Already in this project"><i class="fas fa-check-circle"></i></span>'
        : '';
      
      return `
        <div class="library-item ${audio.isInCurrentProject ? 'already-in-project' : ''}" data-audio-id="${audio.id}" data-audio-url="${audio.audio_url || ''}" data-type="audio">
          <div class="fallback-thumb"><i class="fas fa-music"></i></div>
          ${inProjectBadge}
          <div class="video-overlay">
            <div class="video-title" title="${audio.name || 'Untitled'}">${title}</div>
            <div class="video-info">
              <span class="model-badge upload">audio</span>
              <span class="duration">${duration}</span>
            </div>
          </div>
          <div class="add-icon">
            <i class="fas fa-plus"></i>
          </div>
        </div>
      `;
    }).join('');
    
    gridEl.innerHTML = html;
    
    // Attach click handlers for audio files
    gridEl.querySelectorAll('.library-item[data-type="audio"]').forEach(item => {
      item.addEventListener('click', async (e) => {
        if (e.detail > 1) return;
        
        const audioId = item.dataset.audioId;
        const audioUrl = item.dataset.audioUrl;
        
        if (!audioUrl) {
          VE.showToast('error', 'No Audio URL', 'This audio file is not available');
          return;
        }
        
        // Check if already in current project
        if (item.classList.contains('already-in-project')) {
          VE.showToast('info', 'Already Added', 'This audio file is already in your project');
          return;
        }
        
        item.classList.add('loading');
        item.style.pointerEvents = 'none';
        
        try {
          await VE.importAudioToProject(audioId, audioUrl);
          // Mark as in project
          item.classList.add('already-in-project');
        } finally {
          item.classList.remove('loading');
          item.style.pointerEvents = '';
        }
      });
    });
  };

  // Import audio file to project
  VE.importAudioToProject = async function(audioId, audioUrl) {
    const audio = VE.uploadedAudioFiles.find(a => a.id === audioId);
    if (!audio || !audioUrl) {
      VE.showToast('error', 'Import Failed', 'Audio file not available');
      return;
    }
    
    const shortName = audio.name ? audio.name.substring(0, 30) : 'Audio File';
    
    try {
      // Create asset from the audio file
      const asset = {
        id: VE.generateId(),
        name: audio.name || 'Uploaded Audio',
        type: 'audio',
        file: null,
        objectUrl: audioUrl,
        isRemote: true,
        remoteUrl: audioUrl,
        size: 0,
        duration: audio.duration || 0,
        width: 0,
        height: 0,
        thumbnail: null,
        uploadId: audioId,
        isProjectAsset: false // Will be set to true after saving reference
      };
      
      // Load audio metadata
      if (audioUrl) {
        try {
          const tempAudio = document.createElement('audio');
          tempAudio.preload = 'metadata';
          tempAudio.src = audioUrl;
          
          await new Promise((resolve) => {
            const timeout = setTimeout(resolve, 5000);
            tempAudio.onloadedmetadata = () => {
              clearTimeout(timeout);
              asset.duration = tempAudio.duration || audio.duration || 0;
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
      
      // Add to assets
      VE.state.assets.push(asset);

      if (VE.projectState && VE.projectState.currentProjectId) {
        asset.uploadId = audioId;
        asset.isProjectAsset = true;
      }
      
      // Show upload zone area if needed
      if (VE.elements.uploadZone) {
        VE.elements.uploadZone.style.display = 'none';
      }
      if (VE.elements.assetGrid) {
        VE.elements.assetGrid.classList.add('visible');
      }
      
      VE.renderAssetGrid();
      
      // Audio is only added to project assets, not automatically to timeline
      // User can double-click the asset to add it to timeline if needed
      VE.showToast('success', 'Audio Added', 'Added to project assets');
      
      // Update the audio file's status in library and re-render
      audio.isInCurrentProject = true;
      VE.renderAudioGrid();
      
    } catch (error) {
      console.error('Failed to import audio:', error);
      VE.showToast('error', 'Import Failed', error.message || 'Could not add audio file');
    }
  };

  VE.isVideoCompleted = function(video, model) {
    switch (model) {
      case 'veo':
        return video.status === 'completed' || video.status === 'SUCCEEDED' || 
               (video.video_url || video.download_url);
      case 'seedance':
      case 'bytedance':
        return video.status === 'succeeded' || 
               (video.video_url || video.content?.video_url);
      case 'sora':
        return video.status === 'succeeded' || video.video_url;
      case 'kling':
        return video.status === 'succeed' && video.videos?.length > 0;
      default:
        return false;
    }
  };

  VE.renderLibraryGrid = function() {
    const gridEl = document.getElementById('library-grid');
    const emptyEl = document.getElementById('library-empty');
    
    if (!gridEl) return;
    
    const hasAIVideos = VE.libraryVideos.length > 0;
    const hasUserUploads = VE.libraryUserUploads.length > 0;
    
    // Show empty state if no content for active tab
    const activeTab = VE.activeLibraryTab || 'ai-generated';
    const showAITab = activeTab === 'ai-generated';
    const showUploadsTab = activeTab === 'my-uploads';
    
    if ((showAITab && !hasAIVideos) || (showUploadsTab && !hasUserUploads)) {
      gridEl.innerHTML = '';
      gridEl.style.display = 'none';
      if (emptyEl) {
        emptyEl.querySelector('p').textContent = showAITab 
          ? 'No AI generated videos yet' 
          : 'No uploaded files yet';
        emptyEl.querySelector('.hint').textContent = showAITab
          ? 'Generate videos using AI models to see them here'
          : 'Upload videos, images, or audio files to see them here';
        emptyEl.style.display = 'flex';
      }
      return;
    }
    
    // Show grid, hide empty state
    gridEl.style.display = 'grid';
    if (emptyEl) emptyEl.style.display = 'none';
    
    let html = '';
    
    // Render content based on active tab
    if (showAITab && hasAIVideos) {
      html += VE.libraryVideos.map(video => {
        // Truncate title for display
        const title = video.prompt && video.prompt.length > 40 
          ? video.prompt.substring(0, 40) + '...' 
          : (video.prompt || 'Untitled video');
        
        // Fallback thumbnail - use video element with poster or colored placeholder
        // Prioritize preview_url for video thumbnails, then video_url, then thumbnail image
        // Check if thumbnail is an actual image (has image extension) vs a video URL
        const isThumbnailImage = video.thumbnail && (
          video.thumbnail.match(/\.(jpg|jpeg|png|gif|webp)$/i) || 
          video.thumbnail.startsWith('data:image/')
        );
        const previewUrl = video.preview_url || video.video_url;
        let thumbnailHtml;
        if (isThumbnailImage) {
          // Use thumbnail image if it's actually an image
          thumbnailHtml = `<img src="${video.thumbnail}" alt="${title}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
            <div class="fallback-thumb" style="display:none;"><i class="fas fa-film"></i></div>`;
        } else if (previewUrl) {
          // Use video element with preview_url or video_url
          // Escape the URL for HTML attribute
          const safePreviewUrl = previewUrl.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
          thumbnailHtml = `<div class="video-thumb-wrapper">
            <video src="${safePreviewUrl}" muted preload="metadata" playsinline
              onloadeddata="this.currentTime=0.5; this.style.opacity='1';" 
              onloadedmetadata="this.currentTime=0.5; this.style.opacity='1';"
              oncanplay="this.style.opacity='1';"
              onerror="console.error('Video load error:', this.error, this.src); this.style.display='none'; const fallback = this.nextElementSibling; if(fallback) fallback.style.display='flex';"
              style="opacity: 0; transition: opacity 0.3s; width: 100%; height: 100%; object-fit: cover;">
            </video>
            <div class="fallback-thumb" style="display:none;"><i class="fas fa-film"></i></div>
          </div>`;
        } else {
          thumbnailHtml = `<div class="fallback-thumb"><i class="fas fa-film"></i></div>`;
        }
        
        const duration = typeof video.duration === 'number' 
          ? VE.formatTimeShort(video.duration)
          : video.duration || '0:05';
        
        // Show badge if already in current project
        const inProjectBadge = video.isInCurrentProject 
          ? '<span class="in-project-badge" title="Already in this project"><i class="fas fa-check-circle"></i></span>'
          : '';
        
        // Prioritize preview_url over video_url
        // preview_url is more reliable 
        const videoUrlForPlayback = video.preview_url || video.video_url || '';
        
        return `
          <div class="library-item ${video.isInCurrentProject ? 'already-in-project' : ''}" data-video-id="${video.id}" data-video-url="${videoUrlForPlayback}" data-preview-url="${video.preview_url || ''}" data-type="ai">
            ${thumbnailHtml}
            ${inProjectBadge}
            <div class="video-overlay">
              <div class="video-title" title="${video.prompt || 'Untitled'}">${title}</div>
            </div>
            <div class="add-icon">
              <i class="fas fa-plus"></i>
            </div>
          </div>
        `;
      }).join('');
    } else if (showUploadsTab && hasUserUploads) {
      html += VE.libraryUserUploads.map(upload => {
        // Truncate name for display
        const title = upload.name && upload.name.length > 30 
          ? upload.name.substring(0, 30) + '...' 
          : (upload.name || 'Uploaded file');
        
        // Get icon based on media type
        const mediaIcon = upload.mediaType === 'audio' ? 'fa-music' : 
                          upload.mediaType === 'image' ? 'fa-image' : 'fa-film';
        
        // Fallback thumbnail
        let thumbnailHtml;
        if (upload.thumbnail) {
          thumbnailHtml = `<img src="${upload.thumbnail}" alt="${title}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
            <div class="fallback-thumb" style="display:none;"><i class="fas ${mediaIcon}"></i></div>`;
        } else if (upload.video_url && upload.mediaType === 'video') {
          thumbnailHtml = `<div class="video-thumb-wrapper">
            <video src="${upload.video_url}" muted preload="metadata" 
              onloadeddata="this.currentTime=0.5;" 
              onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
            </video>
            <div class="fallback-thumb" style="display:none;"><i class="fas fa-film"></i></div>
          </div>`;
        } else if (upload.video_url && upload.mediaType === 'image') {
          thumbnailHtml = `<img src="${upload.video_url}" alt="${title}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
            <div class="fallback-thumb" style="display:none;"><i class="fas fa-image"></i></div>`;
        } else {
          thumbnailHtml = `<div class="fallback-thumb"><i class="fas ${mediaIcon}"></i></div>`;
        }
        
        const duration = typeof upload.duration === 'number' 
          ? VE.formatTimeShort(upload.duration)
          : upload.duration || '--';
        
        // Show badge if already in current project
        const inProjectBadge = upload.isInCurrentProject 
          ? '<span class="in-project-badge" title="Already in this project"><i class="fas fa-check-circle"></i></span>'
          : '';
        
        // Media type badge
        const typeBadge = upload.mediaType === 'audio' ? 'audio' : 
                          upload.mediaType === 'image' ? 'image' : 'video';
        
        return `
          <div class="library-item ${upload.isInCurrentProject ? 'already-in-project' : ''}" data-upload-id="${upload.id}" data-video-url="${upload.video_url || ''}" data-type="upload" data-media-type="${upload.mediaType}">
            ${thumbnailHtml}
            ${inProjectBadge}
            <div class="video-overlay">
              <div class="video-title" title="${upload.name || 'Untitled'}">${title}</div>
            </div>
            <div class="add-icon">
              <i class="fas fa-plus"></i>
            </div>
          </div>
        `;
      }).join('');
    }
    
    gridEl.innerHTML = html;
    
    // Initialize tab switching
    VE.initLibraryTabs();
    
    // Attach click handlers for AI videos
    gridEl.querySelectorAll('.library-item[data-type="ai"]').forEach(item => {
      item.addEventListener('click', async (e) => {
        if (e.detail > 1) return;
        
        const videoId = item.dataset.videoId;
        const videoUrl = item.dataset.videoUrl;
        if (!videoUrl) {
          VE.showToast('error', 'No Video URL', 'This video is not available');
          return;
        }
        
        // Check if already in current project
        if (item.classList.contains('already-in-project')) {
          VE.showToast('info', 'Already Added', 'This video is already in your project');
          return;
        }
        
        item.classList.add('loading');
        item.style.pointerEvents = 'none';
        
        try {
          await VE.importLibraryVideo(videoId, videoUrl, true);
          // Mark as in project
          item.classList.add('already-in-project');
        } finally {
          item.classList.remove('loading');
          item.style.pointerEvents = '';
        }
      });
    });
    
    // Attach click handlers for user uploads
    gridEl.querySelectorAll('.library-item[data-type="upload"]').forEach(item => {
      item.addEventListener('click', async (e) => {
        if (e.detail > 1) return;
        
        const uploadId = item.dataset.uploadId;
        const videoUrl = item.dataset.videoUrl || ''; // Allow empty, function will handle fallback
        const mediaType = item.dataset.mediaType;
        
        // Check if already in current project
        if (item.classList.contains('already-in-project')) {
          VE.showToast('info', 'Already Added', 'This file is already in your project');
          return;
        }
        
        item.classList.add('loading');
        item.style.pointerEvents = 'none';
        
        try {
          await VE.importUserUploadToProject(uploadId, videoUrl, mediaType);
          // Mark as in project
          item.classList.add('already-in-project');
        } finally {
          item.classList.remove('loading');
          item.style.pointerEvents = '';
        }
      });
    });
  };
  
  // Import user upload to current project
  VE.importUserUploadToProject = async function(uploadId, videoUrl, mediaType) {
    let upload = VE.libraryUserUploads.find(u => u.id === uploadId);
    
    // If not found in library cache, fetch it from API
    if (!upload) {
      if (!VE.projectState || !VE.projectState.currentProjectId) {
        VE.showToast('error', 'Import Failed', 'No project open');
        return;
      }
      try {
        const res = await window.apiService.request(
          `/projects/${VE.projectState.currentProjectId}/assets`
        );
        const rows = (res && res.uploads) || [];
        const row = rows.find(r => r.id === uploadId);
        if (row) {
          const metadata = row.metadata || {};
          const assetMediaType = metadata.media_type || row.media_type || 'video';
          const previewUrl = row.preview_url || row.download_url;
          upload = {
            id: row.id,
            type: 'upload',
            mediaType: assetMediaType,
            name: row.original_filename || 'Uploaded File',
            video_url: previewUrl,
            preview_url: row.preview_url,
            download_url: row.download_url,
            thumbnail: metadata.thumbnail_url || metadata.thumbnailUrl || null,
            duration: metadata.duration || metadata.duration_seconds || 5,
            created_at: row.created_at || new Date().toISOString(),
            project_id: VE.projectState.currentProjectId,
            isInCurrentProject: false
          };
        }
      } catch (error) {
        console.error('Failed to fetch upload:', error);
      }
      if (!upload) {
        VE.showToast('error', 'Import Failed', 'File not found');
        return;
      }
    }
    
    // Use videoUrl parameter if provided, otherwise fall back to upload's video_url, preview_url, or download_url
    const fileUrl = videoUrl || upload.video_url || upload.preview_url || upload.download_url;
    if (!fileUrl) {
      console.error('No file URL available for upload:', uploadId, upload);
      VE.showToast('error', 'Import Failed', 'File URL not available');
      return;
    }
    
    console.log('Importing upload:', { uploadId, fileUrl, mediaType, upload });
    
    const shortName = upload.name ? upload.name.substring(0, 30) : 'File';
    const actualMediaType = mediaType || upload.mediaType || 'video';
    
    try {
      // Create asset from the upload
      const asset = {
        id: VE.generateId(),
        name: upload.name || 'Uploaded File',
        type: mediaType || upload.mediaType || 'video',
        file: null,
        objectUrl: fileUrl,
        isRemote: true,
        remoteUrl: fileUrl,
        size: 0,
        duration: upload.duration || 5,
        width: 1920,
        height: 1080,
        thumbnail: upload.thumbnail || null,
        uploadId: uploadId,
        isProjectAsset: false // Will be set to true after saving reference
      };
      
      // Load media metadata
      const actualMediaType = mediaType || upload.mediaType || 'video';
      if (actualMediaType === 'video' && fileUrl) {
        try {
          const tempVideo = document.createElement('video');
          tempVideo.preload = 'auto';
          tempVideo.src = fileUrl;
          
          await new Promise((resolve) => {
            const timeout = setTimeout(resolve, 5000);
            tempVideo.onloadedmetadata = () => {
              clearTimeout(timeout);
              asset.duration = tempVideo.duration || upload.duration || 5;
              asset.width = tempVideo.videoWidth || 1920;
              asset.height = tempVideo.videoHeight || 1080;
              resolve();
            };
            tempVideo.onerror = () => {
              clearTimeout(timeout);
              resolve();
            };
          });
        } catch (e) {
          console.warn('Error loading video metadata:', e);
        }
      } else if (actualMediaType === 'image') {
        asset.duration = 5;
        asset.thumbnail = asset.thumbnail || fileUrl;
        // Load image dimensions
        try {
          const tempImg = new Image();
          tempImg.onload = () => {
            asset.width = tempImg.naturalWidth || 1920;
            asset.height = tempImg.naturalHeight || 1080;
          };
          tempImg.src = fileUrl;
        } catch (e) {
          console.warn('Error loading image dimensions:', e);
        }
      } else if (actualMediaType === 'audio') {
        try {
          const tempAudio = document.createElement('audio');
          tempAudio.preload = 'metadata';
          tempAudio.src = fileUrl;
          
          await new Promise((resolve) => {
            const timeout = setTimeout(resolve, 5000);
            tempAudio.onloadedmetadata = () => {
              clearTimeout(timeout);
              asset.duration = tempAudio.duration || upload.duration || 0;
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
      
      // Add to assets
      VE.state.assets.push(asset);

      if (VE.projectState && VE.projectState.currentProjectId) {
        asset.uploadId = uploadId;
        asset.isProjectAsset = true;
      }
      
      // Show upload zone area if needed
      if (VE.elements.uploadZone) {
        VE.elements.uploadZone.style.display = 'none';
      }
      if (VE.elements.assetGrid) {
        VE.elements.assetGrid.classList.add('visible');
      }
      
      VE.renderAssetGrid();
      
      // // Add to timeline based on type
      // if (actualMediaType === 'audio') {
      //   VE.addAudioToTimeline(asset);
      //   VE.showToast('success', 'Audio Added', 'Added to audio track');
      // } else if (actualMediaType === 'image') {
      //   // Images should not be added to timeline automatically
      //   // They can be added manually by the user if needed
      //   VE.showToast('success', 'Image Added', 'Added to project assets');
      // } else {
      //   // Videos: add to timeline and preview
      //   VE.addToTimeline(asset);
      //   VE.loadVideoToPreview(asset);
      //   VE.showToast('success', 'Video Added', 'Added to project');
      // }
      
      // Update the upload's status in library and re-render
      upload.isInCurrentProject = true;
      VE.renderLibraryGrid();
      
    } catch (error) {
      console.error('Failed to import upload:', error);
      VE.showToast('error', 'Import Failed', error.message || 'Could not add file');
    }
  };

  VE.importLibraryVideo = async function() {
    VE.showToast('info', 'Not available', 'Add media via Project Assets.');
  };

  // Import AI generated image to current project
  VE.importImageToProject = async function(imageId, imageUrl, addToTimeline = false) {
    const image = VE.libraryImages.find(img => img.id === imageId);
    if (!image || !imageUrl) {
      VE.showToast('error', 'Import Failed', 'Image URL not available');
      return;
    }
    
    const shortPrompt = image.prompt ? image.prompt.substring(0, 30) : 'Image';
    
    try {
      // Create asset from library image
      const asset = {
        id: VE.generateId(),
        name: `${image.model.toUpperCase()}: ${shortPrompt}${image.prompt && image.prompt.length > 30 ? '...' : ''}`,
        type: 'image',
        file: null,
        objectUrl: imageUrl,
        isRemote: true,
        remoteUrl: imageUrl,
        size: 0,
        duration: 3, // Default duration for images
        width: 1920,
        height: 1080,
        thumbnail: image.thumbnail || imageUrl,
        libraryImageId: imageId,
        model: image.model
      };

      // Load image to get dimensions
      const tempImg = document.createElement('img');
      tempImg.crossOrigin = 'anonymous';
      
      const loadPromise = new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          console.log('Image load timeout, proceeding with defaults');
          resolve('timeout');
        }, 5000); // 5 second timeout
        
        tempImg.onload = () => {
          clearTimeout(timeoutId);
          asset.width = tempImg.naturalWidth || 1920;
          asset.height = tempImg.naturalHeight || 1080;
          console.log('Image loaded:', asset.width, asset.height);
          resolve('loaded');
        };
        
        tempImg.onerror = (e) => {
          clearTimeout(timeoutId);
          console.error('Image load error:', e);
          reject(new Error('Image failed to load'));
        };
        
        tempImg.src = imageUrl;
      });
      
      try {
        await loadPromise;
      } catch (e) {
        console.warn('Image load failed, using defaults:', e);
      }
      
      // Use image URL as thumbnail if not set
      if (!asset.thumbnail) {
        asset.thumbnail = imageUrl;
      }
      
      // Add to assets
      VE.state.assets.push(asset);

      // Show in upload zone area if needed
      if (VE.elements.uploadZone) {
        VE.elements.uploadZone.style.display = 'none';
      }
      if (VE.elements.assetGrid) {
        VE.elements.assetGrid.classList.add('visible');
      }
      
      VE.renderAssetGrid();
      
      // Update images library's "in project" status
      if (typeof VE.updateImagesProjectStatus === 'function') {
        VE.updateImagesProjectStatus();
      }
      
      // Add to timeline
      if (addToTimeline) {
        console.log('Adding image to timeline:', asset);
        VE.addToTimeline(asset);
        // Also load to preview so it's visible
        setTimeout(() => {
          VE.loadVideoToPreview(asset);
        }, 100);
      } else {
        // Just show success message
        VE.showToast('success', 'Image Imported', 'Added to assets');
      }
      
    } catch (error) {
      console.error('Failed to import library image:', error);
      VE.showToast('error', 'Import Failed', error.message || 'Could not load image');
    }
  };

  // Refresh library (can be called to reload)
  VE.refreshLibrary = function() {
    VE.libraryLoaded = false;
    VE.libraryVideos = [];
    VE.libraryUserUploads = [];
    VE.userUploadsLoaded = false;
  };

  // Update "in project" status in library without full reload
  VE.updateLibraryProjectStatus = function() {
    // Get current project asset IDs (for uploads)
    const projectAssetIds = new Set(
      VE.state.assets.filter(a => a.isProjectAsset).map(a => a.uploadId || a.id)
    );
    
    // Get current project reference IDs (for AI generated videos)
    const projectReferenceIds = new Set(
      VE.state.assets.filter(a => a.isProjectAsset && a.isReference).map(a => a.id || a.libraryVideoId)
    );
    
    // Update status for each upload
    if (VE.libraryUserUploads && VE.libraryUserUploads.length > 0) {
      VE.libraryUserUploads.forEach(upload => {
        upload.isInCurrentProject = projectAssetIds.has(upload.id);
      });
    }
    
    // Update status for each AI generated video
    if (VE.libraryVideos && VE.libraryVideos.length > 0) {
      VE.libraryVideos.forEach(video => {
        video.isInCurrentProject = projectReferenceIds.has(video.id);
      });
    }
    
    // Re-render if library tab is active
    const libraryContent = document.getElementById('library-content');
    if (libraryContent && libraryContent.classList.contains('active')) {
      VE.renderLibraryGrid();
    }
  };

  // Initialize library tabs
  VE.initLibraryTabs = function() {
    const tabs = document.querySelectorAll('.library-tab');
    if (!tabs.length) return;
    
    tabs.forEach(tab => {
      tab.addEventListener('click', async function() {
        const tabType = this.dataset.tab;
        
        // Update active state
        tabs.forEach(t => t.classList.remove('active'));
        this.classList.add('active');
        
        // Update active tab
        VE.activeLibraryTab = tabType;
        
        // Load data based on selected tab
        if (tabType === 'ai-generated') {
          // Load AI generated videos if not already loaded
          if (!VE.libraryLoaded) {
            await VE.loadAIGeneratedVideos();
          } else {
            VE.renderLibraryGrid();
          }
        } else if (tabType === 'my-uploads') {
          // Load user uploads if not already loaded
          if (!VE.userUploadsLoaded) {
            await VE.loadUserUploads();
          } else {
            VE.renderLibraryGrid();
          }
        }
      });
    });
  };

  // ============================================
  // Images Tab - AI Generated and Uploaded Images
  // ============================================
  
  // Cache for images in library
  VE.libraryImages = [];
  VE.libraryImageUploads = [];
  VE.imagesLoaded = false;
  VE.imageUploadsLoaded = false;
  VE.activeImagesTab = 'ai-generated-images'; // Track active tab
  
  // Pagination state for images tabs
  VE.imagesPaginationState = {
    'ai-generated-images': {
      currentPage: 1,
      hasMore: false,
      isLoading: false,
      pageSize: 30
    },
    'my-uploads-images': {
      currentPage: 1,
      hasMore: false,
      isLoading: false,
      pageSize: 30
    }
  };

  // Load AI generated images
  VE.loadAIGeneratedImages = async function(reset = true) {
    const loadingEl = document.getElementById('images-loading');
    const emptyEl = document.getElementById('images-empty');
    const gridEl = document.getElementById('images-grid');
    
    if (!gridEl) return;
    
    const state = VE.imagesPaginationState['ai-generated-images'];
    
    // Prevent multiple simultaneous loads
    if (state.isLoading) {
      return;
    }
    
    // Show loading state
    if (reset) {
      if (loadingEl) loadingEl.style.display = 'flex';
      if (emptyEl) emptyEl.style.display = 'none';
      gridEl.innerHTML = '';
      VE.libraryImages = [];
      state.currentPage = 1;
    } else {
      // Show loading indicator at bottom for pagination
      VE.showImagesLoadingMore();
    }
    
    state.isLoading = true;
    
    try {
      // Fetch AI generated images using unified /assets API (same as image-lab.js)
      const response = await window.apiService.listAllAssets({
        type: 'image',
        source: 'generated',
        page: state.currentPage,
        page_size: state.pageSize,
        sort_by: 'created_at',
        order: 'DESC'
      });
      
      state.isLoading = false;
      
      // Update pagination state
      state.hasMore = response?.has_more || false;
      state.currentPage = response?.page || state.currentPage;
      
      // Handle different response structures (same as image-lab.js)
      let items = [];
      if (response && response.items && Array.isArray(response.items)) {
        items = response.items;
      } else if (response && response.data && Array.isArray(response.data)) {
        items = response.data;
      } else if (Array.isArray(response)) {
        items = response;
      }
      
      // Process AI Generated images
      items.forEach(asset => {
        // Only process image type assets
        if (asset.type !== 'image') return;
        
        // Get image URL from various possible fields (same as image-lab.js)
        const previewUrl = asset.preview_url || asset.download_url || asset.gcp_url || asset.url || asset.image_url || '';
        
        // Only include if we have a URL
        if (!previewUrl) return;
        
        const metadata = asset.metadata || {};
        const model = asset.model || asset.model_provider || asset.model_name || 'unknown';
        
        // Normalize model name for display
        let displayModel = model.toLowerCase();
        if (displayModel === 'bytedance') {
          displayModel = 'seedance';
        }
        
        VE.libraryImages.push({
          id: asset.id,
          model: displayModel,
          prompt: asset.prompt || asset.title || asset.description || `${displayModel} image`,
          image_url: previewUrl,
          thumbnail: metadata.thumbnail_url || previewUrl,
          created_at: asset.created_at || new Date().toISOString()
        });
      });
      
      // Sort by date (newest first)
      VE.libraryImages.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      
      VE.imagesLoaded = true;
      
      // Hide loading
      if (loadingEl) loadingEl.style.display = 'none';
      VE.hideImagesLoadingMore();
      
      // Render the images grid
      VE.renderImagesGrid(reset);
      
    } catch (error) {
      console.error('Failed to load AI generated images:', error);
      state.isLoading = false;
      if (loadingEl) loadingEl.style.display = 'none';
      VE.hideImagesLoadingMore();
      if (emptyEl) {
        emptyEl.querySelector('p').textContent = 'Failed to load images';
        emptyEl.style.display = 'flex';
      }
    }
  };

  // Load uploaded images
  VE.loadUploadedImages = async function(reset = true) {
    const loadingEl = document.getElementById('images-loading');
    const emptyEl = document.getElementById('images-empty');
    const gridEl = document.getElementById('images-grid');
    
    if (!gridEl) return;
    
    const state = VE.imagesPaginationState['my-uploads-images'];
    
    // Prevent multiple simultaneous loads
    if (state.isLoading) {
      return;
    }
    
    // Show loading state
    if (reset) {
      if (loadingEl) loadingEl.style.display = 'flex';
      if (emptyEl) emptyEl.style.display = 'none';
      gridEl.innerHTML = '';
      VE.libraryImageUploads = [];
      state.currentPage = 1;
    } else {
      // Show loading indicator at bottom for pagination
      VE.showImagesLoadingMore();
    }
    
    state.isLoading = true;
    
    try {
      // Fetch uploaded images using unified /assets API (same as image-lab.js)
      const response = await window.apiService.listAllAssets({
        type: 'image',
        source: 'uploaded',
        page: state.currentPage,
        page_size: state.pageSize,
        sort_by: 'created_at',
        order: 'DESC'
      });
      
      state.isLoading = false;
      
      // Update pagination state
      state.hasMore = response?.has_more || false;
      state.currentPage = response?.page || state.currentPage;
      
      // Handle different response structures (same as image-lab.js)
      let items = [];
      if (response && response.items && Array.isArray(response.items)) {
        items = response.items;
      } else if (response && response.data && Array.isArray(response.data)) {
        items = response.data;
      } else if (Array.isArray(response)) {
        items = response;
      }
      
      // Get current project asset IDs to mark which ones are already in project
      const projectAssetIds = new Set(
        VE.state.assets.filter(a => a.isProjectAsset && a.type === 'image').map(a => a.uploadId || a.id)
      );
      
      // Process uploaded images
      items.forEach(asset => {
        // Only process image type assets
        if (asset.type !== 'image') return;
        
        // Get image URL from various possible fields (same as image-lab.js)
        const previewUrl = asset.preview_url || asset.download_url || asset.gcp_url || asset.url || asset.image_url || '';
        
        // Only include if we have a URL
        if (!previewUrl) return;
        
        const metadata = asset.metadata || {};
        
        VE.libraryImageUploads.push({
          id: asset.id,
          type: 'upload',
          name: asset.original_filename || asset.title || 'Uploaded Image',
          image_url: previewUrl,
          thumbnail: metadata.thumbnail_url || previewUrl,
          created_at: asset.created_at || new Date().toISOString(),
          isInCurrentProject: projectAssetIds.has(asset.id)
        });
      });
      
      // Sort by date (newest first)
      VE.libraryImageUploads.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      
      VE.imageUploadsLoaded = true;
      
      // Hide loading
      if (loadingEl) loadingEl.style.display = 'none';
      VE.hideImagesLoadingMore();
      
      // Render the images grid
      VE.renderImagesGrid(reset);
      
    } catch (error) {
      console.error('Failed to load uploaded images:', error);
      state.isLoading = false;
      if (loadingEl) loadingEl.style.display = 'none';
      VE.hideImagesLoadingMore();
      if (emptyEl) {
        emptyEl.querySelector('p').textContent = 'Failed to load uploads';
        emptyEl.style.display = 'flex';
      }
    }
  };

  // Main function - loads AI generated images by default
  VE.loadImages = async function() {
    // Set default tab to AI Generated
    VE.activeImagesTab = 'ai-generated-images';
    
    // Reset pagination for current tab
    const state = VE.imagesPaginationState['ai-generated-images'];
    state.currentPage = 1;
    state.hasMore = false;
    
    // Update tab UI to show AI Generated as active
    const tabs = document.querySelectorAll('#images-tabs .library-tab');
    tabs.forEach(tab => {
      if (tab.dataset.tab === 'ai-generated-images') {
        tab.classList.add('active');
      } else {
        tab.classList.remove('active');
      }
    });
    
    // Load AI generated images
    await VE.loadAIGeneratedImages(true);
  };
  
  // Load more images (pagination)
  VE.loadMoreImages = function() {
    const activeTab = VE.activeImagesTab || 'ai-generated-images';
    const state = VE.imagesPaginationState[activeTab];
    
    // Check if we can load more
    if (state.isLoading || !state.hasMore) {
      return;
    }
    
    // Show loading indicator
    VE.showImagesLoadingMore();
    
    // Increment page and load
    state.currentPage += 1;
    
    if (activeTab === 'ai-generated-images') {
      VE.loadAIGeneratedImages(false);
    } else if (activeTab === 'my-uploads-images') {
      VE.loadUploadedImages(false);
    }
  };
  
  // Show loading more indicator
  VE.showImagesLoadingMore = function() {
    const gridEl = document.getElementById('images-grid');
    if (!gridEl) return;
    
    // Remove existing loader if any
    VE.hideImagesLoadingMore();
    
    const loader = document.createElement('div');
    loader.className = 'library-loading';
    loader.id = 'images-loading-more';
    loader.style.cssText = 'display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 20px; width: 100%; grid-column: 1 / -1;';
    loader.innerHTML = '<div class="spinner"></div><p style="margin-top: 12px; color: var(--v2-text-secondary);">Loading more images...</p>';
    gridEl.appendChild(loader);
  };
  
  // Hide loading more indicator
  VE.hideImagesLoadingMore = function() {
    const loader = document.getElementById('images-loading-more');
    if (loader) {
      loader.remove();
    }
  };

  // Render images grid
  VE.renderImagesGrid = function(reset = true) {
    const gridEl = document.getElementById('images-grid');
    const emptyEl = document.getElementById('images-empty');
    
    if (!gridEl) return;
    
    const hasAIImages = VE.libraryImages.length > 0;
    const hasUploadedImages = VE.libraryImageUploads.length > 0;
    
    // Show empty state if no content for active tab
    const activeTab = VE.activeImagesTab || 'ai-generated-images';
    const showAITab = activeTab === 'ai-generated-images';
    const showUploadsTab = activeTab === 'my-uploads-images';
    
    if ((showAITab && !hasAIImages) || (showUploadsTab && !hasUploadedImages)) {
      if (reset) {
        gridEl.innerHTML = '';
        gridEl.style.display = 'none';
        if (emptyEl) {
          emptyEl.querySelector('p').textContent = showAITab 
            ? 'No AI generated images yet' 
            : 'No uploaded images yet';
          emptyEl.querySelector('.hint').textContent = showAITab
            ? 'Generate images using AI models to see them here'
            : 'Upload images to see them here';
          emptyEl.style.display = 'flex';
        }
      }
      return;
    }
    
    // Show grid, hide empty state
    gridEl.style.display = 'grid';
    if (emptyEl) emptyEl.style.display = 'none';
    
    // If resetting, clear grid first
    if (reset) {
      gridEl.innerHTML = '';
    }
    
    let html = '';
    
    // Render content based on active tab
    if (showAITab && hasAIImages) {
      // If appending, only render new items
      const existingIds = new Set();
      if (!reset) {
        gridEl.querySelectorAll('.library-item[data-image-id]').forEach(item => {
          existingIds.add(item.dataset.imageId);
        });
      }
      
      const newImages = reset ? VE.libraryImages : VE.libraryImages.filter(img => !existingIds.has(img.id));
      
      html += newImages.map(image => {
        // Truncate title for display
        const title = image.prompt && image.prompt.length > 40 
          ? image.prompt.substring(0, 40) + '...' 
          : (image.prompt || 'Untitled image');
        
        // Image thumbnail
        let thumbnailHtml;
        if (image.thumbnail || image.image_url) {
          const imgUrl = image.thumbnail || image.image_url;
          thumbnailHtml = `<img src="${imgUrl}" alt="${title}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
            <div class="fallback-thumb" style="display:none;"><i class="fas fa-image"></i></div>`;
        } else {
          thumbnailHtml = `<div class="fallback-thumb"><i class="fas fa-image"></i></div>`;
        }
        
        return `
          <div class="library-item" data-image-id="${image.id}" data-image-url="${image.image_url || ''}" data-type="ai-image">
            ${thumbnailHtml}
            <div class="video-overlay">
              <div class="video-title" title="${image.prompt || 'Untitled'}">${title}</div>
            </div>
            <div class="add-icon">
              <i class="fas fa-plus"></i>
            </div>
          </div>
        `;
      }).join('');
    } else if (showUploadsTab && hasUploadedImages) {
      html += VE.libraryImageUploads.map(upload => {
        // Truncate name for display
        const title = upload.name && upload.name.length > 30 
          ? upload.name.substring(0, 30) + '...' 
          : (upload.name || 'Uploaded image');
        
        // Image thumbnail
        let thumbnailHtml;
        if (upload.thumbnail || upload.image_url) {
          const imgUrl = upload.thumbnail || upload.image_url;
          thumbnailHtml = `<img src="${imgUrl}" alt="${title}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
            <div class="fallback-thumb" style="display:none;"><i class="fas fa-image"></i></div>`;
        } else {
          thumbnailHtml = `<div class="fallback-thumb"><i class="fas fa-image"></i></div>`;
        }
        
        // Show badge if already in current project
        const inProjectBadge = upload.isInCurrentProject 
          ? '<span class="in-project-badge" title="Already in this project"><i class="fas fa-check-circle"></i></span>'
          : '';
        
        return `
          <div class="library-item ${upload.isInCurrentProject ? 'already-in-project' : ''}" data-upload-id="${upload.id}" data-image-url="${upload.image_url || ''}" data-type="upload-image">
            ${thumbnailHtml}
            ${inProjectBadge}
            <div class="video-overlay">
              <div class="video-title" title="${upload.name || 'Untitled'}">${title}</div>
            </div>
            <div class="add-icon">
              <i class="fas fa-plus"></i>
            </div>
          </div>
        `;
      }).join('');
    }
    
    // Append or set HTML
    if (reset) {
      gridEl.innerHTML = html;
    } else {
      // Remove loading more indicator before appending
      VE.hideImagesLoadingMore();
      gridEl.insertAdjacentHTML('beforeend', html);
    }
    
    // Initialize images tabs (only on first render)
    if (reset) {
      VE.initImagesTabs();
    }
    
    // Attach click handlers for AI images (only for new items if appending)
    const aiImageItems = reset 
      ? gridEl.querySelectorAll('.library-item[data-type="ai-image"]')
      : gridEl.querySelectorAll('.library-item[data-type="ai-image"]:not([data-handler-attached])');
    
    aiImageItems.forEach(item => {
      item.dataset.handlerAttached = 'true';
      item.addEventListener('click', async (e) => {
        if (e.detail > 1) return;
        
        const imageId = item.dataset.imageId;
        const imageUrl = item.dataset.imageUrl;
        if (!imageUrl) {
          VE.showToast('error', 'No Image URL', 'This image is not available');
          return;
        }
        
        item.classList.add('loading');
        item.style.pointerEvents = 'none';
        
        try {
          await VE.importImageToProject(imageId, imageUrl);
        } finally {
          item.classList.remove('loading');
          item.style.pointerEvents = '';
        }
      });
    });
    
    // Attach click handlers for uploaded images (only for new items if appending)
    const uploadImageItems = reset
      ? gridEl.querySelectorAll('.library-item[data-type="upload-image"]')
      : gridEl.querySelectorAll('.library-item[data-type="upload-image"]:not([data-handler-attached])');
    
    uploadImageItems.forEach(item => {
      item.dataset.handlerAttached = 'true';
      item.addEventListener('click', async (e) => {
        if (e.detail > 1) return;
        
        const uploadId = item.dataset.uploadId;
        const imageUrl = item.dataset.imageUrl;
        
        if (!imageUrl) {
          VE.showToast('error', 'No Image URL', 'This image is not available');
          return;
        }
        
        // Check if already in current project
        if (item.classList.contains('already-in-project')) {
          VE.showToast('info', 'Already Added', 'This image is already in your project');
          return;
        }
        
        item.classList.add('loading');
        item.style.pointerEvents = 'none';
        
        try {
          await VE.importUserUploadToProject(uploadId, imageUrl, 'image');
          // Mark as in project
          item.classList.add('already-in-project');
        } finally {
          item.classList.remove('loading');
          item.style.pointerEvents = '';
        }
      });
    });
  };

  // Initialize images tabs
  VE.initImagesTabs = function() {
    const tabs = document.querySelectorAll('#images-tabs .library-tab');
    if (!tabs.length) return;
    
    tabs.forEach(tab => {
      // Remove existing listeners to avoid duplicates
      const newTab = tab.cloneNode(true);
      tab.parentNode.replaceChild(newTab, tab);
      
      newTab.addEventListener('click', async function() {
        const tabType = this.dataset.tab;
        
        // Get fresh references to all tabs after cloning
        const allTabs = document.querySelectorAll('#images-tabs .library-tab');
        
        // Update active state - remove from all tabs first
        allTabs.forEach(t => t.classList.remove('active'));
        // Then add to clicked tab
        this.classList.add('active');
        
        // Update active tab
        VE.activeImagesTab = tabType;
        
        // Reset pagination for new tab
        const state = VE.imagesPaginationState[tabType];
        state.currentPage = 1;
        state.hasMore = false;
        
        // Load data based on selected tab
        if (tabType === 'ai-generated-images') {
          // Always reload when switching tabs
          VE.imagesLoaded = false;
          await VE.loadAIGeneratedImages(true);
        } else if (tabType === 'my-uploads-images') {
          // Always reload when switching tabs
          VE.imageUploadsLoaded = false;
          await VE.loadUploadedImages(true);
        }
      });
    });
    
    // Setup infinite scroll for images grid
    VE.setupImagesInfiniteScroll();
  };
  
  // Setup infinite scroll for images grid
  VE.setupImagesInfiniteScroll = function() {
    // Find the scrollable container - media-import-zone is the scrollable area (same as image-lab.js pattern)
    const mediaImportZone = document.getElementById('media-import-zone');
    if (!mediaImportZone) return;
    
    // Remove existing listener if any
    if (mediaImportZone._imagesScrollHandler) {
      mediaImportZone.removeEventListener('scroll', mediaImportZone._imagesScrollHandler);
    }
    
    // Add scroll listener (same pattern as image-lab.js)
    mediaImportZone._imagesScrollHandler = function() {
      // Only trigger if images panel is active
      const imagesPanel = document.getElementById('images-panel');
      if (!imagesPanel || !imagesPanel.classList.contains('active')) {
        return;
      }
      
      const activeTab = VE.activeImagesTab || 'ai-generated-images';
      const state = VE.imagesPaginationState[activeTab];
      
      // Check if we're near the bottom (within 200px) - same as image-lab.js
      const scrollTop = this.scrollTop;
      const scrollHeight = this.scrollHeight;
      const clientHeight = this.clientHeight;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      
      if (distanceFromBottom < 200 && state.hasMore && !state.isLoading) {
        VE.loadMoreImages();
      }
    };
    
    mediaImportZone.addEventListener('scroll', mediaImportZone._imagesScrollHandler);
  };

  // Update "in project" status in images library without full reload
  VE.updateImagesProjectStatus = function() {
    if (!VE.libraryImageUploads || VE.libraryImageUploads.length === 0) return;
    
    // Get current project asset IDs
    const projectAssetIds = new Set(
      VE.state.assets.filter(a => a.isProjectAsset && a.type === 'image').map(a => a.uploadId || a.id)
    );
    
    // Update status for each upload
    VE.libraryImageUploads.forEach(upload => {
      upload.isInCurrentProject = projectAssetIds.has(upload.id);
    });
    
    // Re-render if images tab is active
    const imagesPanel = document.getElementById('images-panel');
    if (imagesPanel && imagesPanel.classList.contains('active')) {
      VE.renderImagesGrid();
    }
  };

})();

