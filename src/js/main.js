import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MindARThree } from 'mind-ar';

class WebARApp {
    constructor() {
        this.mindarThree = null;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.model = null;
        this.mediaRecorder = null;
        this.recordedChunks = [];
        this.isRecording = false;
        this.videoElement = null;
        this.compositeCanvas = null;
        this.compositeCtx = null;
        this.initialModelY = undefined;
        this.initialModelRotationY = undefined;
        this.floatTime = 0;
        this.rotationTime = 0;
        this.shadowPlane = null;
        this.floatAmplitude = 0.015;
        this.floatSpeed = 1.5;
        this.rotationSpeed = 0.3;
        this.anchor = null;
        this.isTargetVisible = false;
        
        // Stabilization properties
        this.targetPosition = new THREE.Vector3();
        this.targetRotation = new THREE.Euler();
        this.smoothingFactor = 0.15; // Lower = smoother, higher = more responsive
        this.confidenceThreshold = 0.7;
        this.trackingConfidence = 0;
        this.lastStableTime = 0;
        this.stabilizationDelay = 100; // ms
        this.positionHistory = [];
        this.rotationHistory = [];
        this.historySize = 5;
        
        // Performance optimization - mobile-specific settings
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        this.isMobile = isMobile;
        
        // Reduce frame rate for mobile devices
        this.targetFPS = isMobile ? 30 : 60; // 30fps for mobile, 60fps for desktop
        this.frameInterval = 1000 / this.targetFPS;
        this.lastFrameTime = 0;
        
        // Performance monitoring
        this.performanceMonitor = {
            frameCount: 0,
            lastFPSUpdate: 0,
            currentFPS: 0
        };
        
        // App state tracking
        this.isAppActive = true;
        this.resizeListenerAdded = false;
        
        // Canvas update optimization
        this.lastCanvasUpdate = 0;
        this.canvasUpdateInterval = isMobile ? 100 : 50; // Update canvas less frequently on mobile
        
        this.init();
    }

    async init() {
        try {
            // Show loading progress
            this.updateLoadingProgress('Setting up AR...', 20);
            
            await this.setupAR();
            
            this.updateLoadingProgress('Loading 3D model...', 50);
            
            // Preload the 3D model before starting AR
            await this.preloadModel();
            
            this.updateLoadingProgress('Preparing interface...', 80);
            
            this.setupUI();
            
            this.updateLoadingProgress('Starting AR experience...', 100);
            
            this.startAR();
        } catch (error) {
            console.error('Failed to initialize WebAR:', error);
            this.showStatus('Failed to initialize AR', true);
        }
    }

    updateLoadingProgress(message, percentage) {
        const loadingScreen = document.getElementById('loading-screen');
        const loadingContent = loadingScreen.querySelector('.loading-content');
        const progressText = loadingContent.querySelector('p');
        
        if (progressText) {
            progressText.textContent = message;
        }
        
        // Update progress bar if it exists, or create one
        let progressBar = loadingContent.querySelector('.progress-bar');
        if (!progressBar) {
            progressBar = document.createElement('div');
            progressBar.className = 'progress-bar';
            progressBar.innerHTML = `
                <div class="progress-fill"></div>
            `;
            loadingContent.appendChild(progressBar);
        }
        
        const progressFill = progressBar.querySelector('.progress-fill');
        progressFill.style.width = `${percentage}%`;
    }

    async preloadModel() {
        const loader = new GLTFLoader();
        
        try {
            const gltf = await new Promise((resolve, reject) => {
                loader.load(
                    './src/assets/models/parfume/parfume.glb', // CHANGED: now loads parfume.glb (GLB model)
                    resolve,
                    undefined,
                    reject
                );
            });

            this.model = gltf.scene;
            
            // Optimize model for mobile performance
            if (this.isMobile) {
                this.optimizeModelForMobile(this.model);
            }
            
            // Get model bounding box to calculate proper scaling
            const box = new THREE.Box3().setFromObject(this.model);
            const size = box.getSize(new THREE.Vector3());
            const center = box.getCenter(new THREE.Vector3());
            
            // Calculate scale to fit the model within the target bounds
            // Assuming target is roughly 1 unit wide
            const targetSize = 0.8; // 80% of target size for padding
            const maxDimension = Math.max(size.x, size.y, size.z);
            const scale = targetSize / maxDimension;
            
            // Apply scaling
            this.model.scale.set(scale, scale, scale);
            
            // Center the model and position it on top of the target
            this.model.position.set(
                -center.x * scale, // Center horizontally
                -center.y * scale + size.y * scale * 0.5, // Place on top of target
                0.05 // Higher above the target plane for better mobile visibility
            );
            
            // Keep original rotation (no rotation override)
            // this.model.rotation.y = Math.PI;
            
            // Add model to anchor with event listeners for stability
            const anchor = this.mindarThree.addAnchor(0);
            
            // Add target tracking events for smooth transitions
            anchor.onTargetFound = () => {
                this.onTargetFound();
            };
            
            anchor.onTargetLost = () => {
                this.onTargetLost();
            };
            
            // Create a subtle shadow plane (only on desktop)
            if (!this.isMobile) {
                this.createShadowPlane(anchor.group, scale);
            }
            
            // Ensure model is visible before adding to anchor
            this.model.visible = true;
            this.model.traverse((child) => {
                if (child.isMesh) {
                    child.visible = true;
                    if (child.material) {
                        child.material.visible = true;
                        child.material.transparent = false;
                        child.material.opacity = 1.0;
                    }
                }
            });
            
            anchor.group.add(this.model);
            
            // Store anchor reference
            this.anchor = anchor;

            // Add animations if available (limit on mobile)
            if (gltf.animations && gltf.animations.length > 0) {
                this.mixer = new THREE.AnimationMixer(this.model);
                // Limit animations on mobile for better performance
                const maxAnimations = this.isMobile ? 1 : gltf.animations.length;
                for (let i = 0; i < maxAnimations; i++) {
                    this.mixer.clipAction(gltf.animations[i]).play();
                }
            }
            
            // Add floating animation (simplified for mobile)
            this.addFloatingAnimation();

        } catch (error) {
            console.error('Failed to load 3D model:', error);
            this.showStatus('Failed to load 3D model', true);
        }
    }

    async setupAR() {
        // Initialize MindAR
        this.mindarThree = new MindARThree({
            container: document.querySelector('#ar-container'),
            imageTargetSrc: './src/assets/image_targets/targets.mind'
        });

        const { renderer, scene, camera } = this.mindarThree;
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;

        // Configure renderer for media capture and performance
        this.renderer.preserveDrawingBuffer = true;
        this.renderer.autoClear = false;
        this.renderer.setClearColor(0x000000, 0); // Transparent background
        
        // Mobile-specific renderer optimizations
        if (this.isMobile) {
            // Reduce shadow map size for better performance
            this.renderer.shadowMap.enabled = false; // Disable shadows on mobile
            this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Limit pixel ratio
        } else {
            this.renderer.shadowMap.enabled = true;
            this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        }

        // Add optimized lighting for better 3D model appearance
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.8); // Increased ambient light for mobile
        this.scene.add(ambientLight);

        // Main directional light - enhanced for mobile visibility
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0); // Increased intensity
        directionalLight.position.set(2, 2, 1);
        if (!this.isMobile) {
            directionalLight.castShadow = true;
        }
        this.scene.add(directionalLight);
        
        // Add additional fill light for mobile to ensure model visibility
        if (this.isMobile) {
            const fillLight = new THREE.DirectionalLight(0xffffff, 0.6);
            fillLight.position.set(-1, 1, 1);
            this.scene.add(fillLight);
        }
        
        // Only add additional lights on desktop for better performance
        if (!this.isMobile) {
            // Fill light from the opposite side
            const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
            fillLight.position.set(-1, 1, 1);
            this.scene.add(fillLight);
            
            // Rim light from behind
            const rimLight = new THREE.DirectionalLight(0xffffff, 0.2);
            rimLight.position.set(0, 1, -1);
            this.scene.add(rimLight);
        }
    }



    optimizeModelForMobile(model) {
        model.traverse((child) => {
            if (child.isMesh) {
                // Simplify materials for mobile
                if (child.material) {
                    // Reduce texture quality for mobile
                    if (child.material.map) {
                        child.material.map.generateMipmaps = false;
                        child.material.map.minFilter = THREE.LinearFilter;
                    }
                    
                    // Use simpler material types
                    if (child.material.isMeshStandardMaterial) {
                        child.material.roughness = 0.5;
                        child.material.metalness = 0.5;
                    }
                    
                    // Ensure material is visible on mobile
                    child.material.transparent = false;
                    child.material.opacity = 1.0;
                    child.material.visible = true;
                    
                    // Disable features that impact performance
                    child.material.flatShading = false; // Keep smooth shading for better appearance
                    child.material.premultipliedAlpha = false;
                }
                
                // Optimize geometry
                if (child.geometry) {
                    child.geometry.computeBoundingSphere();
                    child.geometry.computeBoundingBox();
                }
                
                // Ensure mesh is visible
                child.visible = true;
            }
        });
    }

    addFloatingAnimation() {
        if (!this.model) return;
        
        // Store initial position and rotation for stable animation
        this.initialModelY = this.model.position.y;
        this.initialModelRotationY = this.model.rotation.y;
        this.floatTime = 0;
        this.rotationTime = 0;
        
        // Animation parameters for stability - reduced to minimize jitter
        if (this.isMobile) {
            // Simplified animations for mobile performance
            this.floatAmplitude = 0.005; // Reduced amplitude
            this.floatSpeed = 0.8; // Slower speed
            this.rotationSpeed = 0.1; // Minimal rotation
        } else {
            // Desktop animations
            this.floatAmplitude = 0.008;
            this.floatSpeed = 1.0;
            this.rotationSpeed = 0.15;
        }
    }

    createShadowPlane(parentGroup, modelScale) {
        // Create a subtle circular shadow beneath the model
        const shadowGeometry = new THREE.CircleGeometry(0.3 * modelScale, 16);
        const shadowMaterial = new THREE.MeshBasicMaterial({
            color: 0x000000,
            opacity: 0.3,
            transparent: true,
            depthWrite: false
        });
        
        const shadowPlane = new THREE.Mesh(shadowGeometry, shadowMaterial);
        shadowPlane.rotation.x = -Math.PI / 2; // Rotate to lie flat
        shadowPlane.position.set(0, 0.001, 0); // Just above the target surface
        
        parentGroup.add(shadowPlane);
        
        // Store reference for animation
        this.shadowPlane = shadowPlane;
    }

    onTargetFound() {
        this.isTargetVisible = true;
        this.trackingConfidence = 1.0;
        this.lastStableTime = Date.now();
        
        // Reset animation timing for smooth start
        this.floatTime = 0;
        this.rotationTime = 0;
        
        // Initialize stabilization
        if (this.anchor && this.anchor.group) {
            this.targetPosition.copy(this.anchor.group.position);
            this.targetRotation.copy(this.anchor.group.rotation);
            this.positionHistory = [];
            this.rotationHistory = [];
        }
        
        // Ensure model is fully visible when target is found
        if (this.model) {
            this.model.traverse((child) => {
                if (child.isMesh && child.material) {
                    // Store original opacity
                    if (!child.material.userData.originalOpacity) {
                        child.material.userData.originalOpacity = child.material.opacity || 1.0;
                    }
                    // Set to fully visible immediately
                    child.material.transparent = false;
                    child.material.opacity = 1.0;
                    child.material.visible = true;
                    child.visible = true;
                }
            });
        }
        
        // Debug logging for mobile
        if (this.isMobile) {
            console.log('Target found - Model should be visible');
        }
    }

    onTargetLost() {
        this.isTargetVisible = false;
        this.trackingConfidence = 0;
        
        // Clear stabilization data
        this.positionHistory = [];
        this.rotationHistory = [];
    }

    setupUI() {
        // Screenshot functionality
        document.getElementById('screenshot-btn').addEventListener('click', () => {
            this.takeScreenshot();
        });

        // Recording functionality
        document.getElementById('record-btn').addEventListener('click', () => {
            this.startRecording();
        });

        document.getElementById('stop-record-btn').addEventListener('click', () => {
            this.stopRecording();
        });

        // Add visibility and focus event handlers for app switching
        this.setupVisibilityHandlers();
    }

    setupVisibilityHandlers() {
        // Handle page visibility changes (switching apps)
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                this.onAppResume();
            } else {
                this.onAppPause();
            }
        });

        // Handle window focus/blur events
        window.addEventListener('focus', () => {
            this.onAppResume();
        });

        window.addEventListener('blur', () => {
            this.onAppPause();
        });

        // Handle page show/hide events (iOS Safari)
        window.addEventListener('pageshow', () => {
            this.onAppResume();
        });

        window.addEventListener('pagehide', () => {
            this.onAppPause();
        });
    }

    onAppPause() {
        // App is being suspended - pause rendering to save resources
        this.isAppActive = false;
    }

    async onAppResume() {
        // App is resuming - reinitialize video and canvas
        this.isAppActive = true;
        
        // Wait a bit for the browser to fully restore
        setTimeout(async () => {
            await this.reinitializeVideoAndCanvas();
        }, 500);
    }

    async reinitializeVideoAndCanvas() {
        try {
            // Re-setup composite canvas
            this.setupCompositeCanvas();
            
            // Force a render to ensure everything is working
            if (this.renderer && this.scene && this.camera) {
                this.renderer.clear();
                this.renderer.render(this.scene, this.camera);
            }
            
            // Update canvas size to match current container
            this.updateCanvasSize();
            
            // Check if MindAR needs to be restarted
            if (this.mindarThree && !this.mindarThree.isStarted) {
                await this.mindarThree.start();
            }
        } catch (error) {
            console.error('Failed to reinitialize video and canvas:', error);
        }
    }

    // Stabilization methods
    updateTrackingStabilization() {
        if (!this.anchor || !this.anchor.group || !this.isTargetVisible) return;

        const currentTime = Date.now();
        const anchorGroup = this.anchor.group;
        
        // Add current position and rotation to history
        this.addToHistory(this.positionHistory, anchorGroup.position.clone());
        this.addToHistory(this.rotationHistory, anchorGroup.rotation.clone());
        
        // Calculate smoothed position and rotation
        const smoothedPosition = this.calculateSmoothedPosition();
        const smoothedRotation = this.calculateSmoothedRotation();
        
        // Apply smoothing based on confidence and stability
        const timeSinceStable = currentTime - this.lastStableTime;
        const isStable = timeSinceStable > this.stabilizationDelay;
        
        if (isStable && this.trackingConfidence > this.confidenceThreshold) {
            // Apply smoothed values
            this.targetPosition.lerp(smoothedPosition, this.smoothingFactor);
            this.targetRotation.x = THREE.MathUtils.lerp(this.targetRotation.x, smoothedRotation.x, this.smoothingFactor);
            this.targetRotation.y = THREE.MathUtils.lerp(this.targetRotation.y, smoothedRotation.y, this.smoothingFactor);
            this.targetRotation.z = THREE.MathUtils.lerp(this.targetRotation.z, smoothedRotation.z, this.smoothingFactor);
            
            // Apply to anchor group
            anchorGroup.position.copy(this.targetPosition);
            anchorGroup.rotation.copy(this.targetRotation);
        }
    }

    addToHistory(history, value) {
        history.push(value);
        if (history.length > this.historySize) {
            history.shift();
        }
    }

    calculateSmoothedPosition() {
        if (this.positionHistory.length === 0) return new THREE.Vector3();
        
        const smoothed = new THREE.Vector3();
        let totalWeight = 0;
        
        // Weighted average with more recent positions having higher weight
        for (let i = 0; i < this.positionHistory.length; i++) {
            const weight = (i + 1) / this.positionHistory.length;
            smoothed.add(this.positionHistory[i].clone().multiplyScalar(weight));
            totalWeight += weight;
        }
        
        return smoothed.divideScalar(totalWeight);
    }

    calculateSmoothedRotation() {
        if (this.rotationHistory.length === 0) return new THREE.Euler();
        
        // Simple average for rotation (more complex quaternion slerp could be used)
        const smoothed = new THREE.Euler();
        let totalWeight = 0;
        
        for (let i = 0; i < this.rotationHistory.length; i++) {
            const weight = (i + 1) / this.rotationHistory.length;
            smoothed.x += this.rotationHistory[i].x * weight;
            smoothed.y += this.rotationHistory[i].y * weight;
            smoothed.z += this.rotationHistory[i].z * weight;
            totalWeight += weight;
        }
        
        smoothed.x /= totalWeight;
        smoothed.y /= totalWeight;
        smoothed.z /= totalWeight;
        
        return smoothed;
    }

    updatePerformanceMonitor(currentTime) {
        this.performanceMonitor.frameCount++;
        
        if (currentTime - this.performanceMonitor.lastFPSUpdate >= 1000) {
            this.performanceMonitor.currentFPS = this.performanceMonitor.frameCount;
            this.performanceMonitor.frameCount = 0;
            this.performanceMonitor.lastFPSUpdate = currentTime;
            

        }
    }

    async startAR() {
        // Hide loading screen
        document.getElementById('loading-screen').classList.add('hidden');
        
        // Start MindAR
        await this.mindarThree.start();
        
        // Setup composite canvas for media capture
        this.setupCompositeCanvas();
               
        // Start render loop
        this.render();
    }

    setupCompositeCanvas() {
        // Clear existing canvas if reinitializing
        if (this.compositeCanvas) {
            this.compositeCanvas.remove();
            this.compositeCanvas = null;
            this.compositeCtx = null;
        }

        // Wait a bit for MindAR to fully initialize
        setTimeout(() => {
            // Get the video element from MindAR
            const container = document.querySelector('#ar-container');
            this.videoElement = container.querySelector('video');
            
            if (!this.videoElement) {
                // Retry after a short delay
                setTimeout(() => this.setupCompositeCanvas(), 500);
                return;
            }

            // Create a composite canvas for combining video and 3D content
            this.compositeCanvas = document.createElement('canvas');
            this.compositeCtx = this.compositeCanvas.getContext('2d');
            
            // Set canvas positioning to cover the entire viewport
            this.compositeCanvas.style.position = 'fixed';
            this.compositeCanvas.style.top = '0';
            this.compositeCanvas.style.left = '0';
            this.compositeCanvas.style.zIndex = '1000';
            this.compositeCanvas.style.pointerEvents = 'none'; // Allow interaction with elements below
            
            this.updateCanvasSize();
            
            // Add video event listeners for better mobile handling (reduced for performance)
            const videoEvents = ['loadedmetadata', 'canplay', 'playing'];
            if (!this.isMobile) {
                // Add additional events only on desktop
                videoEvents.push('loadeddata', 'canplaythrough');
            }
            
            videoEvents.forEach(event => {
                this.videoElement.addEventListener(event, () => {
                    this.updateCompositeCanvas();
                });
            });
            
            // Force initial update to ensure canvas has content
            setTimeout(() => {
                this.updateCompositeCanvas();
            }, 100);
            
            // Add resize listener for responsive behavior (only once)
            if (!this.resizeListenerAdded) {
                // Debounced resize handler for better performance
                let resizeTimeout;
                const debouncedResize = () => {
                    clearTimeout(resizeTimeout);
                    resizeTimeout = setTimeout(() => {
                        this.updateCanvasSize();
                    }, 250);
                };
                
                window.addEventListener('resize', debouncedResize);
                
                // Add orientation change listener
                window.addEventListener('orientationchange', () => {
                    setTimeout(() => {
                        this.updateCanvasSize();
                    }, 100);
                });
                
                this.resizeListenerAdded = true;
            }
            


        }, this.isAppActive === false ? 100 : 1000); // Shorter delay when resuming
    }

    updateCanvasSize() {
        if (!this.compositeCanvas) return;
        
        const container = document.querySelector('#ar-container');
        const containerRect = container.getBoundingClientRect();
                
        // Get device pixel ratio for high-DPI displays
        const pixelRatio = window.devicePixelRatio || 1;
        
        // Use viewport dimensions instead of container for proper mobile sizing
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        
        // Calculate target dimensions based on viewport size
        let targetWidth = viewportWidth * pixelRatio;
        let targetHeight = viewportHeight * pixelRatio;
        
        // Mobile-specific size optimization
        if (this.isMobile) {
            // Limit canvas size on mobile for better performance
            const maxMobileWidth = 1280;
            const maxMobileHeight = 720;
            
            if (targetWidth > maxMobileWidth) {
                const scale = maxMobileWidth / targetWidth;
                targetWidth = maxMobileWidth;
                targetHeight = targetHeight * scale;
            }
            
            if (targetHeight > maxMobileHeight) {
                const scale = maxMobileHeight / targetHeight;
                targetHeight = maxMobileHeight;
                targetWidth = targetWidth * scale;
            }
        } else {
            // Ensure minimum quality for small screens
            const minWidth = 320 * pixelRatio;
            const minHeight = 240 * pixelRatio;
            
            targetWidth = Math.max(targetWidth, minWidth);
            targetHeight = Math.max(targetHeight, minHeight);
        }
        
        // Set canvas dimensions to match viewport size
        this.compositeCanvas.width = targetWidth;
        this.compositeCanvas.height = targetHeight;
        
        // Set canvas CSS size to match viewport
        this.compositeCanvas.style.width = `${viewportWidth}px`;
        this.compositeCanvas.style.height = `${viewportHeight}px`;
        
        // Ensure canvas is properly positioned for mobile
        this.compositeCanvas.style.position = 'fixed';
        this.compositeCanvas.style.top = '0';
        this.compositeCanvas.style.left = '0';
        this.compositeCanvas.style.zIndex = '1000';
        this.compositeCanvas.style.pointerEvents = 'none';
        

    }

    render() {
        const currentTime = performance.now();
        
        // Frame rate control for consistent performance
        if (currentTime - this.lastFrameTime < this.frameInterval) {
            requestAnimationFrame(() => this.render());
            return;
        }
        
        const deltaTime = Math.min((currentTime - this.lastFrameTime) / 1000, 0.033); // Cap at 30fps minimum
        this.lastFrameTime = currentTime;
        
        // Performance monitoring (only log occasionally)
        this.updatePerformanceMonitor(currentTime);
        
        requestAnimationFrame(() => this.render());
        
        // Skip rendering if app is not active (paused)
        if (this.isAppActive === false) {
            return;
        }
        
        // Update tracking stabilization first
        this.updateTrackingStabilization();
        
        if (this.mixer) {
            this.mixer.update(deltaTime);
        }
        
        // Update smooth and stable animations
        if (this.model && this.initialModelY !== undefined) {
            
            // Handle visibility based on target detection
            if (this.isTargetVisible) {
                // Ensure model is fully visible when target is visible
                this.model.traverse((child) => {
                    if (child.isMesh && child.material) {
                        child.material.transparent = false;
                        child.material.opacity = 1.0;
                        child.material.visible = true;
                        child.visible = true;
                    }
                });
                
                // Smooth floating animation with easing (only when visible)
                this.floatTime += deltaTime;
                const floatSin = Math.sin(this.floatTime * this.floatSpeed);
                const easedFloat = floatSin * floatSin * Math.sign(floatSin); // Cubic easing for smoother motion
                const floatOffset = easedFloat * this.floatAmplitude;
                this.model.position.y = this.initialModelY + floatOffset;
                
                // Minimal rotation animation with damping
                this.rotationTime += deltaTime;
                const rotationSin = Math.sin(this.rotationTime * this.rotationSpeed);
                const dampedRotation = rotationSin * 0.05; // Reduced rotation amplitude
                this.model.rotation.y = this.initialModelRotationY + dampedRotation;
                
                // Animate shadow with smoother transitions (only on desktop)
                if (this.shadowPlane && !this.isMobile) {
                    const normalizedFloat = (floatOffset / this.floatAmplitude); // -1 to 1
                    const shadowOpacity = 0.25 - (normalizedFloat * 0.1); // More subtle shadow changes
                    this.shadowPlane.material.opacity = Math.max(0.15, Math.min(0.35, shadowOpacity));
                    
                    // Slightly scale shadow based on height (perspective effect)
                    const shadowScale = 1.0 - (normalizedFloat * 0.05);
                    this.shadowPlane.scale.set(shadowScale, shadowScale, shadowScale);
                }
            } else {
                // Hide model when target is lost
                this.model.traverse((child) => {
                    if (child.isMesh && child.material) {
                        child.material.visible = false;
                        child.visible = false;
                    }
                });
            }
        }
        
        // Clear and render for proper media capture
        this.renderer.clear();
        this.renderer.render(this.scene, this.camera);
        
        // Always update canvas during recording for consistent frame capture
        if (this.isRecording && this.compositeCanvas) {
            this.updateCompositeCanvas();
        } else if (this.compositeCanvas && currentTime - this.lastCanvasUpdate > this.canvasUpdateInterval) {
            this.updateCompositeCanvas();
            this.lastCanvasUpdate = currentTime;
        }
        
        // Remove the additional canvas update during recording since we have a dedicated recording loop
    }

    updateCompositeCanvas() {
        if (!this.compositeCanvas || !this.compositeCtx) {
            return;
        }

        try {
            // Clear composite canvas with proper dimensions
            this.compositeCtx.clearRect(0, 0, this.compositeCanvas.width, this.compositeCanvas.height);
            
            // Ensure canvas is properly sized for recording
            if (this.isRecording && this.compositeCanvas.width === 0) {
                this.updateCanvasSize();
            }
            
            // Check if video element is available and ready
            if (!this.videoElement) {
                // Try to find video element again
                const container = document.querySelector('#ar-container');
                this.videoElement = container.querySelector('video');
                
                if (!this.videoElement) {
                    // Draw placeholder if no video element
                    this.compositeCtx.fillStyle = '#333333';
                    this.compositeCtx.fillRect(0, 0, this.compositeCanvas.width, this.compositeCanvas.height);
                    this.compositeCtx.fillStyle = '#ffffff';
                    this.compositeCtx.font = '20px Arial';
                    this.compositeCtx.textAlign = 'center';
                    this.compositeCtx.fillText('Camera Initializing...', this.compositeCanvas.width / 2, this.compositeCanvas.height / 2);
                    return;
                }
            }
            
            // Simplified video readiness check
            const isVideoReady = this.videoElement && 
                               this.videoElement.videoWidth > 0 && 
                               this.videoElement.videoHeight > 0;
            
            // Draw video background
            if (isVideoReady) {
                this.drawVideoWithAspectRatio();
            } else {
                // Draw a placeholder if video isn't ready
                this.compositeCtx.fillStyle = '#333333';
                this.compositeCtx.fillRect(0, 0, this.compositeCanvas.width, this.compositeCanvas.height);
                this.compositeCtx.fillStyle = '#ffffff';
                this.compositeCtx.font = '20px Arial';
                this.compositeCtx.textAlign = 'center';
                this.compositeCtx.fillText('Video Loading...', this.compositeCanvas.width / 2, this.compositeCanvas.height / 2);
            }
            
            // Draw 3D content on top with proper aspect ratio
            const rendererCanvas = this.renderer.domElement;
            if (rendererCanvas && rendererCanvas.width > 0 && rendererCanvas.height > 0) {
                this.compositeCtx.globalCompositeOperation = 'source-over';
                this.compositeCtx.globalAlpha = 1.0;
                try {
                    // Calculate aspect ratios for 3D content
                    const rendererAspect = rendererCanvas.width / rendererCanvas.height;
                    const canvasAspect = this.compositeCanvas.width / this.compositeCanvas.height;
                    
                    let drawWidth, drawHeight, offsetX, offsetY;
                    
                    if (rendererAspect > canvasAspect) {
                        // Renderer is wider than canvas - fit to width
                        drawWidth = this.compositeCanvas.width;
                        drawHeight = this.compositeCanvas.width / rendererAspect;
                        offsetX = 0;
                        offsetY = (this.compositeCanvas.height - drawHeight) / 2;
                    } else {
                        // Renderer is taller than canvas - fit to height
                        drawHeight = this.compositeCanvas.height;
                        drawWidth = this.compositeCanvas.height * rendererAspect;
                        offsetX = (this.compositeCanvas.width - drawWidth) / 2;
                        offsetY = 0;
                    }
                    
                    // Ensure we're drawing to a valid canvas area
                    if (drawWidth > 0 && drawHeight > 0) {
                        this.compositeCtx.drawImage(
                            rendererCanvas,
                            0, 0, rendererCanvas.width, rendererCanvas.height,
                            offsetX, offsetY, drawWidth, drawHeight
                        );
                    }

                } catch (error) {
                    console.error('Error drawing 3D content:', error);
                }
            }
            
        } catch (error) {
            console.error('Error in updateCompositeCanvas:', error);
        }
    }

    drawVideoWithAspectRatio() {
        const video = this.videoElement;
        const canvas = this.compositeCanvas;
        const ctx = this.compositeCtx;

        try {
            // Calculate aspect ratios
            const videoAspect = video.videoWidth / video.videoHeight;
            const canvasAspect = canvas.width / canvas.height;
            
            let drawWidth, drawHeight, offsetX, offsetY;
            
            // Use object-fit: cover behavior (same as CSS)
            if (videoAspect > canvasAspect) {
                // Video is wider than canvas - fit to height and crop width
                drawHeight = canvas.height;
                drawWidth = canvas.height * videoAspect;
                offsetX = (canvas.width - drawWidth) / 2;
                offsetY = 0;
            } else {
                // Video is taller than canvas - fit to width and crop height
                drawWidth = canvas.width;
                drawHeight = canvas.width / videoAspect;
                offsetX = 0;
                offsetY = (canvas.height - drawHeight) / 2;
            }
            
            // Fill background with black
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // Draw video with cover behavior (cropped to fill)
            ctx.drawImage(
                video,
                offsetX, offsetY,
                drawWidth,
                drawHeight
            );

        } catch (error) {
            console.error('Error drawing video:', error);
            
            // Fallback: fill with a test pattern
            ctx.fillStyle = '#ff0000';
            ctx.fillRect(0, 0, canvas.width / 2, canvas.height);
            ctx.fillStyle = '#00ff00';
            ctx.fillRect(canvas.width / 2, 0, canvas.width / 2, canvas.height);
        }
    }

    takeScreenshot() {
        try {
            // Force a render first to ensure 3D content is up to date
            this.renderer.clear();
            this.renderer.render(this.scene, this.camera);
            
            const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
            
            // Enhanced screenshot logic with mobile-specific handling
            if (this.compositeCanvas) {
                // Force update composite canvas
                this.updateCompositeCanvas();
                
                // Wait for next frame to ensure render is complete
                requestAnimationFrame(() => {
                    // Check if composite canvas has video content
                    let hasVideoContent = false;
                    
                    if (isMobile) {
                        // More lenient check for mobile
                        hasVideoContent = this.videoElement && 
                                        (this.videoElement.videoWidth > 0 || this.videoElement.readyState >= 1);
                    } else {
                        // Standard check for desktop
                        hasVideoContent = this.videoElement && 
                                        this.videoElement.videoWidth > 0 && 
                                        this.videoElement.videoHeight > 0;
                    }
                    
                    if (hasVideoContent) {
                        this.captureFromCanvas(this.compositeCanvas, 'composite');
                    } else {
                        this.captureFromCanvas(this.renderer.domElement, 'renderer');
                    }
                });
            } else if (this.videoElement && this.videoElement.videoWidth > 0) {
                this.captureFromVideo();
            } else {
                this.captureFromCanvas(this.renderer.domElement, 'renderer');
            }
            
        } catch (error) {
            console.error('Screenshot failed:', error);
            this.showStatus('Screenshot failed', true);
        }
    }

    captureFromCanvas(canvas, method) {
        requestAnimationFrame(() => {
            try {
                // For mobile devices, ensure we're using the correct canvas dimensions
                const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
                
                // Create a temporary canvas for mobile to ensure proper dimensions
                if (isMobile && canvas === this.compositeCanvas) {
                    const tempCanvas = document.createElement('canvas');
                    const tempCtx = tempCanvas.getContext('2d');
                    
                    // Use device pixel ratio for high-DPI displays
                    const pixelRatio = window.devicePixelRatio || 1;
                    const viewportWidth = window.innerWidth * pixelRatio;
                    const viewportHeight = window.innerHeight * pixelRatio;
                    
                    tempCanvas.width = viewportWidth;
                    tempCanvas.height = viewportHeight;
                    
                    // Draw the composite canvas to the temp canvas
                    tempCtx.drawImage(canvas, 0, 0, viewportWidth, viewportHeight);
                    
                    const dataURL = tempCanvas.toDataURL('image/png', 1.0);
                    
                    if (dataURL.length < 1000) {
                        throw new Error(`${method} canvas appears to be empty`);
                    }
                    
                    this.downloadImage(dataURL);
                    this.showStatus('Screenshot saved!');
                } else {
                    // Standard desktop capture
                    const dataURL = canvas.toDataURL('image/png', 1.0);
                    
                    if (dataURL.length < 1000) {
                        throw new Error(`${method} canvas appears to be empty`);
                    }
                    
                    this.downloadImage(dataURL);
                    this.showStatus('Screenshot saved!');
                }
            } catch (error) {
                console.error(`${method} canvas capture failed:`, error);
                this.showStatus(`Screenshot failed (${method})`, true);
            }
        });
    }

    captureFromVideo() {
        try {
            // Create a temporary canvas to capture video frame
            const tempCanvas = document.createElement('canvas');
            const tempCtx = tempCanvas.getContext('2d');
            
            // Use actual video dimensions or fallback to container size
            const container = document.querySelector('#ar-container');
            const containerRect = container.getBoundingClientRect();
            const pixelRatio = window.devicePixelRatio || 1;
            
            // Use video's native dimensions for best quality
            const videoWidth = this.videoElement.videoWidth;
            const videoHeight = this.videoElement.videoHeight;
            
            if (videoWidth && videoHeight) {
                // Use video's native resolution
                tempCanvas.width = videoWidth;
                tempCanvas.height = videoHeight;
                
                // Draw video at native resolution
                tempCtx.drawImage(this.videoElement, 0, 0, videoWidth, videoHeight);
            } else {
                // Fallback to container size with aspect ratio preservation
                const containerWidth = containerRect.width * pixelRatio;
                const containerHeight = containerRect.height * pixelRatio;
                
                tempCanvas.width = containerWidth;
                tempCanvas.height = containerHeight;
                
                // Fill with black background
                tempCtx.fillStyle = '#000000';
                tempCtx.fillRect(0, 0, containerWidth, containerHeight);
                
                // Draw video with cover behavior (same as CSS object-fit: cover)
                const videoAspect = this.videoElement.videoWidth / this.videoElement.videoHeight;
                const canvasAspect = containerWidth / containerHeight;
                
                let drawWidth, drawHeight, offsetX, offsetY;
                
                if (videoAspect > canvasAspect) {
                    // Video is wider than canvas - fit to height and crop width
                    drawHeight = containerHeight;
                    drawWidth = containerHeight * videoAspect;
                    offsetX = (containerWidth - drawWidth) / 2;
                    offsetY = 0;
                } else {
                    // Video is taller than canvas - fit to width and crop height
                    drawWidth = containerWidth;
                    drawHeight = containerWidth / videoAspect;
                    offsetX = 0;
                    offsetY = (containerHeight - drawHeight) / 2;
                }
                
                tempCtx.drawImage(this.videoElement, offsetX, offsetY, drawWidth, drawHeight);
            }
            
            const dataURL = tempCanvas.toDataURL('image/png', 1.0);
            
            if (dataURL.length < 1000) {
                throw new Error('Video capture appears to be empty');
            }
            
            this.downloadImage(dataURL);
            this.showStatus('Screenshot saved!');
        } catch (error) {
            console.error('Video capture failed:', error);
            this.showStatus('Video capture failed', true);
        }
    }

    downloadImage(dataURL) {
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
        
        if (isIOS) {
            // iOS Safari has limitations with download links, use alternative approach
            try {
                // Create a new window/tab to display the image
                const newWindow = window.open();
                newWindow.document.write(`
                    <html>
                        <head>
                            <title>Screenshot</title>
                            <style>
                                body { margin: 0; padding: 20px; background: #f0f0f0; }
                                img { max-width: 100%; height: auto; border: 1px solid #ccc; }
                                .download-btn { 
                                    display: block; 
                                    margin: 20px 0; 
                                    padding: 10px 20px; 
                                    background: #007AFF; 
                                    color: white; 
                                    text-decoration: none; 
                                    border-radius: 5px; 
                                    text-align: center; 
                                }
                            </style>
                        </head>
                        <body>
                            <img src="${dataURL}" alt="Screenshot" />
                            <a href="${dataURL}" download="webAR-screenshot-${Date.now()}.png" class="download-btn">
                                Download Screenshot
                            </a>
                            <p>Tap and hold the image above to save it to your device.</p>
                        </body>
                    </html>
                `);
                newWindow.document.close();
            } catch (error) {
                console.error('Failed to open image in new window:', error);
                // Fallback to standard download
                this.standardDownload(dataURL);
            }
        } else {
            // Standard download for other devices
            this.standardDownload(dataURL);
        }
    }

    standardDownload(dataURL) {
        const link = document.createElement('a');
        link.download = `webAR-screenshot-${Date.now()}.png`;
        link.href = dataURL;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    async startRecording() {
        try {
            // Check if MediaRecorder is supported
            if (!MediaRecorder) {
                throw new Error('Recording not supported in this browser');
            }
            
            // Ensure composite canvas is properly set up and updated
            if (!this.compositeCanvas || !this.compositeCtx) {
                this.setupCompositeCanvas();
                // Wait for setup to complete
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
            // Optimize canvas for recording on mobile
            if (this.isMobile) {
                this.optimizeCanvasForRecording();
            }
            
            // Wait for video to be ready before recording (with mobile fallback)
            if (this.videoElement) {
                await this.waitForVideoReady();
            }
            
            // Force update composite canvas before recording
            this.updateCompositeCanvas();
            
            // Wait a frame to ensure canvas is properly updated
            await new Promise(resolve => requestAnimationFrame(resolve));
            
            let canvasToRecord = this.compositeCanvas;
            
            // Always use composite canvas for recording
            if (!canvasToRecord || canvasToRecord.width === 0) {
                throw new Error('Composite canvas not ready for recording');
            }
            
            if (!canvasToRecord.captureStream) {
                throw new Error('Canvas stream capture not supported');
            }
            
            // Prioritize MP4 format for better smartphone compatibility
            const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
            
            let mimeTypes;
            if (isMobile) {
                // Mobile-first MIME types with strong MP4 preference
                mimeTypes = [
                    'video/mp4;codecs=h264',
                    'video/mp4;codecs=avc1',
                    'video/mp4',
                    'video/webm;codecs=vp9',
                    'video/webm;codecs=vp8',
                    'video/webm'
                ];
            } else {
                // Desktop MIME types
                mimeTypes = [
                    'video/mp4;codecs=h264',
                    'video/mp4',
                    'video/webm;codecs=vp9',
                    'video/webm;codecs=vp8',
                    'video/webm'
                ];
            }
            
            let selectedMimeType = null;
            for (const mimeType of mimeTypes) {
                const isSupported = MediaRecorder.isTypeSupported(mimeType);
                if (isSupported && !selectedMimeType) {
                    selectedMimeType = mimeType;
                }
            }
            
            // Ensure we have a valid MIME type
            if (!selectedMimeType) {
                selectedMimeType = 'video/webm';
            }
            
            if (!selectedMimeType) {
                throw new Error('No supported video format found');
            }
            
            // Optimized stream settings with higher frame rate for better capture
            const frameRate = this.isMobile ? 30 : 60; // Increased mobile frame rate
            const stream = canvasToRecord.captureStream(frameRate);
            
            // Verify stream has video tracks
            if (!stream.getVideoTracks().length) {
                throw new Error('No video tracks available');
            }
            
            // Clear any previous recording data
            this.recordedChunks = [];
            
            // Mobile-optimized MediaRecorder settings
            const recorderOptions = {
                mimeType: selectedMimeType
            };
            
            if (this.isMobile) {
                // Lower bitrate for mobile to reduce lag
                recorderOptions.videoBitsPerSecond = 1500000; // 1.5 Mbps for mobile
            } else {
                // Higher bitrate for desktop
                recorderOptions.videoBitsPerSecond = 4000000; // 4 Mbps for desktop
            }
            
            this.mediaRecorder = new MediaRecorder(stream, recorderOptions);

            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data && event.data.size > 0) {
                    this.recordedChunks.push(event.data);
                }
            };

            this.mediaRecorder.onstop = () => {
                this.saveRecording();
            };

            this.mediaRecorder.onerror = (event) => {
                console.error('MediaRecorder error:', event.error);
                this.showStatus('Recording error occurred', true);
                this.resetRecordingUI();
            };

            // Optimized timeslice settings for better frame capture
            const timeslice = this.isMobile ? 100 : 50; // Reduced chunk size for more frequent updates
            this.mediaRecorder.start(timeslice);
            this.isRecording = true;
            
            // Start recording-specific update loop for better frame capture
            this.startRecordingUpdateLoop();
            
            // Update UI
            document.getElementById('record-btn').classList.add('hidden');
            document.getElementById('stop-record-btn').classList.remove('hidden');
            document.getElementById('stop-record-btn').classList.add('recording');
            
            this.showStatus('Recording started');
            
        } catch (error) {
            console.error('Recording failed to start:', error);
            this.showStatus(`Recording failed: ${error.message}`, true);
            this.resetRecordingUI();
        }
    }

    optimizeCanvasForRecording() {
        if (!this.compositeCanvas) return;
        
        // Store original canvas size for restoration
        if (!this.originalCanvasSize) {
            this.originalCanvasSize = {
                width: this.compositeCanvas.width,
                height: this.compositeCanvas.height
            };
        }
        
        // Reduce canvas size for mobile recording to improve performance
        const pixelRatio = window.devicePixelRatio || 1;
        const maxRecordingWidth = 720; // Reduced from 1280
        const maxRecordingHeight = 480; // Reduced from 720
        
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        
        // Calculate optimal recording size
        let targetWidth = Math.min(viewportWidth * pixelRatio, maxRecordingWidth * pixelRatio);
        let targetHeight = Math.min(viewportHeight * pixelRatio, maxRecordingHeight * pixelRatio);
        
        // Maintain aspect ratio
        const aspectRatio = viewportWidth / viewportHeight;
        if (targetWidth / targetHeight > aspectRatio) {
            targetWidth = targetHeight * aspectRatio;
        } else {
            targetHeight = targetWidth / aspectRatio;
        }
        
        // Set optimized canvas size for recording
        this.compositeCanvas.width = targetWidth;
        this.compositeCanvas.height = targetHeight;
        
        // Update CSS size to maintain visual appearance
        this.compositeCanvas.style.width = `${viewportWidth}px`;
        this.compositeCanvas.style.height = `${viewportHeight}px`;
    }

    startRecordingUpdateLoop() {
        // Create a dedicated update loop for recording to ensure smooth frame capture
        const recordingUpdateLoop = () => {
            if (this.isRecording && this.compositeCanvas) {
                // Force render and update
                this.renderer.clear();
                this.renderer.render(this.scene, this.camera);
                this.updateCompositeCanvas();
                
                // Use requestAnimationFrame for better timing and performance
                requestAnimationFrame(recordingUpdateLoop);
            }
        };
        
        // Start the recording update loop
        recordingUpdateLoop();
    }

    stopRecording() {
        if (this.mediaRecorder && this.isRecording) {
            try {
                this.mediaRecorder.stop();
                this.isRecording = false;
                
                // Restore original canvas size on mobile
                if (this.isMobile && this.originalCanvasSize) {
                    this.restoreCanvasSize();
                }
                
                this.resetRecordingUI();
                this.showStatus('Recording stopped');
            } catch (error) {
                console.error('Error stopping recording:', error);
                this.showStatus('Error stopping recording', true);
                this.resetRecordingUI();
            }
        }
    }

    restoreCanvasSize() {
        if (!this.compositeCanvas || !this.originalCanvasSize) return;
        
        // Restore original canvas size
        this.compositeCanvas.width = this.originalCanvasSize.width;
        this.compositeCanvas.height = this.originalCanvasSize.height;
        
        // Update CSS size to match viewport
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        this.compositeCanvas.style.width = `${viewportWidth}px`;
        this.compositeCanvas.style.height = `${viewportHeight}px`;
        
        // Clear the stored original size
        this.originalCanvasSize = null;
    }

    resetRecordingUI() {
        document.getElementById('record-btn').classList.remove('hidden', 'recording');
        document.getElementById('stop-record-btn').classList.add('hidden', 'recording');
        this.isRecording = false;
    }

    saveRecording() {
        try {
            if (!this.recordedChunks.length) {
                throw new Error('No recording data available');
            }
            
            // Check total size of all chunks
            const totalSize = this.recordedChunks.reduce((sum, chunk) => sum + chunk.size, 0);
            
            if (totalSize === 0) {
                throw new Error('Recording is empty (0 bytes)');
            }
            
            // Determine file extension and MIME type based on the MediaRecorder's MIME type
            const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
            const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
            let fileExtension = 'mp4';
            let mimeType = 'video/mp4';
            
            if (this.mediaRecorder && this.mediaRecorder.mimeType) {
                const recorderMimeType = this.mediaRecorder.mimeType.toLowerCase();
                
                if (recorderMimeType.includes('webm')) {
                    if (isMobile) {
                        // Force MP4 for mobile even if MediaRecorder uses WebM
                        fileExtension = 'mp4';
                        mimeType = 'video/mp4';
                    } else {
                        fileExtension = 'webm';
                        mimeType = 'video/webm';
                    }
                } else if (recorderMimeType.includes('mp4')) {
                    fileExtension = 'mp4';
                    mimeType = 'video/mp4';
                } else {
                    // Fallback: check if we're on mobile and force MP4
                    if (isMobile) {
                        fileExtension = 'mp4';
                        mimeType = 'video/mp4';
                    }
                }
            } else if (isMobile) {
                // No MIME type specified, force MP4 for mobile
                fileExtension = 'mp4';
                mimeType = 'video/mp4';
            }
            

            
            const blob = new Blob(this.recordedChunks, { type: mimeType });
            
            if (blob.size === 0) {
                throw new Error('Recording blob is empty');
            }
            

            
            const url = URL.createObjectURL(blob);
            
            if (isIOS) {
                // iOS Safari has limitations with download links, use alternative approach
                try {
                    // Create a new window/tab to display the video
                    const newWindow = window.open();
                    newWindow.document.write(`
                        <html>
                            <head>
                                <title>Recording</title>
                                <style>
                                    body { margin: 0; padding: 20px; background: #f0f0f0; }
                                    video { max-width: 100%; height: auto; border: 1px solid #ccc; }
                                    .download-btn { 
                                        display: block; 
                                        margin: 20px 0; 
                                        padding: 10px 20px; 
                                        background: #007AFF; 
                                        color: white; 
                                        text-decoration: none; 
                                        border-radius: 5px; 
                                        text-align: center; 
                                    }
                                </style>
                            </head>
                            <body>
                                <video controls autoplay>
                                    <source src="${url}" type="${mimeType}">
                                    Your browser does not support the video tag.
                                </video>
                                <a href="${url}" download="webAR-recording-${Date.now()}.${fileExtension}" class="download-btn">
                                    Download Recording
                                </a>
                                <p>Tap and hold the video above to save it to your device.</p>
                            </body>
                        </html>
                    `);
                    newWindow.document.close();
                } catch (error) {
                    console.error('Failed to open video in new window:', error);
                    // Fallback to standard download
                    this.standardDownloadRecording(url, fileExtension);
                }
            } else {
                // Standard download for other devices
                this.standardDownloadRecording(url, fileExtension);
            }
            
            this.recordedChunks = [];
            
            this.showStatus('Recording saved!');
        } catch (error) {
            console.error('Failed to save recording:', error);
            this.showStatus(`Save failed: ${error.message}`, true);
            
            // Clear chunks on error to prevent accumulation
            this.recordedChunks = [];
        }
    }

    standardDownloadRecording(url, fileExtension) {
        // Create download link
        const link = document.createElement('a');
        link.download = `webAR-recording-${Date.now()}.${fileExtension}`;
        link.href = url;
        link.style.display = 'none';
        document.body.appendChild(link);
        
        // Trigger download
        link.click();
        
        // Clean up
        setTimeout(() => {
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        }, 1000);
    }

    async waitForVideoReady() {
        return new Promise((resolve) => {
            if (!this.videoElement) {
                resolve();
                return;
            }
            
            const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
            let attempts = 0;
            const maxAttempts = isMobile ? 50 : 30; // 5 seconds for mobile, 3 seconds for desktop
            
            const checkVideoReady = () => {
                attempts++;
                
                let isReady = false;
                
                if (isMobile) {
                    // More lenient check for mobile devices
                    isReady = this.videoElement.videoWidth > 0 && 
                              this.videoElement.videoHeight > 0;
                    
                    // For mobile, also accept partial video data
                    if (!isReady && this.videoElement.readyState >= 1) {
                        isReady = true;
                    }
                } else {
                    // Standard check for desktop
                    isReady = this.videoElement.videoWidth > 0 && 
                              this.videoElement.videoHeight > 0 && 
                              this.videoElement.readyState >= 2;
                }
                
                if (isReady) {
                    resolve();
                } else if (attempts >= maxAttempts) {
                    resolve();
                } else {
                    setTimeout(checkVideoReady, 100);
                }
            };
            
            checkVideoReady();
        });
    }

    showStatus(message, isError = false) {
        const statusEl = document.getElementById('status');
        statusEl.textContent = message;
        statusEl.className = isError ? 'error' : '';
        statusEl.classList.remove('hidden');
        
        setTimeout(() => {
            statusEl.classList.add('hidden');
        }, 3000);
    }
}

// Initialize the WebAR application when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new WebARApp();
}); 