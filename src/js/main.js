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
        
        // Performance optimization
        this.lastFrameTime = 0;
        this.targetFPS = 60;
        this.frameInterval = 1000 / this.targetFPS;
        this.performanceMonitor = {
            frameCount: 0,
            lastFPSUpdate: 0,
            currentFPS: 0
        };
        
        // App state tracking
        this.isAppActive = true;
        this.resizeListenerAdded = false;
        
        this.init();
    }

    async init() {
        try {
            await this.setupAR();
            this.setupUI();
            this.loadModel();
            this.startAR();
        } catch (error) {
            console.error('Failed to initialize WebAR:', error);
            this.showStatus('Failed to initialize AR', true);
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

        // Configure renderer for media capture
        this.renderer.preserveDrawingBuffer = true;
        this.renderer.autoClear = false;
        this.renderer.setClearColor(0x000000, 0); // Transparent background

        // Add enhanced lighting for better 3D model appearance
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
        this.scene.add(ambientLight);

        // Main directional light
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(2, 2, 1);
        directionalLight.castShadow = true;
        this.scene.add(directionalLight);
        
        // Fill light from the opposite side
        const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
        fillLight.position.set(-1, 1, 1);
        this.scene.add(fillLight);
        
        // Rim light from behind
        const rimLight = new THREE.DirectionalLight(0xffffff, 0.2);
        rimLight.position.set(0, 1, -1);
        this.scene.add(rimLight);
    }

    async loadModel() {
        const loader = new GLTFLoader();
        
        try {
            const gltf = await new Promise((resolve, reject) => {
                loader.load(
                    './src/assets/models/softmind/scene.gltf',
                    resolve,
                    undefined,
                    reject
                );
            });

            this.model = gltf.scene;
            
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
                0.02 // Slightly above the target plane for stability
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
            
            // Create a subtle shadow plane
            this.createShadowPlane(anchor.group, scale);
            
            anchor.group.add(this.model);
            
            // Store anchor reference
            this.anchor = anchor;

            // Add animations if available
            if (gltf.animations && gltf.animations.length > 0) {
                this.mixer = new THREE.AnimationMixer(this.model);
                gltf.animations.forEach((clip) => {
                    this.mixer.clipAction(clip).play();
                });
            }
            
            // Add floating animation
            this.addFloatingAnimation();


        } catch (error) {
            console.error('Failed to load 3D model:', error);
            this.showStatus('Failed to load 3D model', true);
        }
    }

    addFloatingAnimation() {
        if (!this.model) return;
        
        // Store initial position and rotation for stable animation
        this.initialModelY = this.model.position.y;
        this.initialModelRotationY = this.model.rotation.y;
        this.floatTime = 0;
        this.rotationTime = 0;
        
        // Animation parameters for stability - reduced to minimize jitter
        this.floatAmplitude = 0.008; // Further reduced for maximum stability
        this.floatSpeed = 1.0; // Even slower floating
        this.rotationSpeed = 0.15; // Minimal rotation for stability
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
        
        // Ensure model is fully opaque when target is found
        if (this.model) {
            this.model.traverse((child) => {
                if (child.isMesh && child.material) {
                    // Store original opacity
                    if (!child.material.userData.originalOpacity) {
                        child.material.userData.originalOpacity = child.material.opacity || 1.0;
                    }
                    // Set to fully opaque immediately
                    child.material.transparent = true;
                    child.material.opacity = child.material.userData.originalOpacity;
                }
            });
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
        console.log('App paused - suspending rendering');
    }

    async onAppResume() {
        // App is resuming - reinitialize video and canvas
        this.isAppActive = true;
        console.log('App resumed - reinitializing video and canvas');
        
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
                console.log('Restarting MindAR...');
                await this.mindarThree.start();
            }
            
            console.log('Video and canvas reinitialized successfully');
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
                console.warn('Video element not found, retrying...');
                // Retry after a short delay
                setTimeout(() => this.setupCompositeCanvas(), 500);
                return;
            }

            // Create a composite canvas for combining video and 3D content
            this.compositeCanvas = document.createElement('canvas');
            this.compositeCtx = this.compositeCanvas.getContext('2d');
            
            this.updateCanvasSize();
            
            // Add resize listener for responsive behavior (only once)
            if (!this.resizeListenerAdded) {
                window.addEventListener('resize', () => {
                    this.updateCanvasSize();
                });
                
                // Add orientation change listener
                window.addEventListener('orientationchange', () => {
                    setTimeout(() => {
                        this.updateCanvasSize();
                    }, 100);
                });
                
                this.resizeListenerAdded = true;
            }
            
            console.log('Composite canvas setup complete');

        }, this.isAppActive === false ? 100 : 1000); // Shorter delay when resuming
    }

    updateCanvasSize() {
        if (!this.compositeCanvas) return;
        
        const container = document.querySelector('#ar-container');
        const containerRect = container.getBoundingClientRect();
                
        // Get device pixel ratio for high-DPI displays
        const pixelRatio = window.devicePixelRatio || 1;
        
        // Use actual container dimensions for responsive behavior
        const containerWidth = containerRect.width || window.innerWidth;
        const containerHeight = containerRect.height || window.innerHeight;
        
        // Calculate target dimensions based on actual container size
        let targetWidth = containerWidth * pixelRatio;
        let targetHeight = containerHeight * pixelRatio;
        
        // Ensure minimum quality for small screens
        const minWidth = 320 * pixelRatio;
        const minHeight = 240 * pixelRatio;
        
        targetWidth = Math.max(targetWidth, minWidth);
        targetHeight = Math.max(targetHeight, minHeight);
        
        // Set canvas dimensions to match container size
        this.compositeCanvas.width = targetWidth;
        this.compositeCanvas.height = targetHeight;
        

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
        
        // Performance monitoring
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
                // Ensure model is fully opaque when target is visible
                this.model.traverse((child) => {
                    if (child.isMesh && child.material && child.material.userData.originalOpacity) {
                        child.material.opacity = child.material.userData.originalOpacity;
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
                
                // Animate shadow with smoother transitions
                if (this.shadowPlane) {
                    const normalizedFloat = (floatOffset / this.floatAmplitude); // -1 to 1
                    const shadowOpacity = 0.25 - (normalizedFloat * 0.1); // More subtle shadow changes
                    this.shadowPlane.material.opacity = Math.max(0.15, Math.min(0.35, shadowOpacity));
                    
                    // Slightly scale shadow based on height (perspective effect)
                    const shadowScale = 1.0 - (normalizedFloat * 0.05);
                    this.shadowPlane.scale.set(shadowScale, shadowScale, shadowScale);
                }
            } else {
                // Fade out model when target is lost
                this.model.traverse((child) => {
                    if (child.isMesh && child.material) {
                        child.material.opacity = Math.max(0, child.material.opacity - deltaTime * 2); // 2x speed fade out
                    }
                });
            }
        }
        
        // Clear and render for proper media capture
        this.renderer.clear();
        this.renderer.render(this.scene, this.camera);
        
        // Update composite canvas if available
        this.updateCompositeCanvas();
    }

    updateCompositeCanvas() {
        if (!this.compositeCanvas || !this.compositeCtx) {
            return;
        }

        try {
            // Clear composite canvas
            this.compositeCtx.clearRect(0, 0, this.compositeCanvas.width, this.compositeCanvas.height);
            
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
            
            // Draw video background
            if (this.videoElement.videoWidth > 0 && this.videoElement.videoHeight > 0 && this.videoElement.readyState >= 2) {
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
            if (rendererCanvas.width > 0 && rendererCanvas.height > 0) {
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
                    
                    this.compositeCtx.drawImage(
                        rendererCanvas,
                        0, 0, rendererCanvas.width, rendererCanvas.height,
                        offsetX, offsetY, drawWidth, drawHeight
                    );

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
            
            // Try multiple methods in order of preference
            if (this.videoElement && this.compositeCanvas) {
                // Wait for next frame to ensure render is complete
                requestAnimationFrame(() => {
                    this.updateCompositeCanvas();
                    // Wait one more frame to ensure composite is ready
                    requestAnimationFrame(() => {
                        this.captureFromCanvas(this.compositeCanvas, 'composite');
                    });
                });
            } else if (this.videoElement) {
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
                const dataURL = canvas.toDataURL('image/png', 1.0);
                
                if (dataURL.length < 1000) {
                    throw new Error(`${method} canvas appears to be empty`);
                }
                
                this.downloadImage(dataURL);
                this.showStatus('Screenshot saved!');
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
        const link = document.createElement('a');
        link.download = `webAR-screenshot-${Date.now()}.png`;
        link.href = dataURL;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    async startRecording() {
        try {
            let canvasToRecord = this.compositeCanvas;
            
            // Check if MediaRecorder is supported
            if (!MediaRecorder) {
                throw new Error('Recording not supported in this browser');
            }
            
            // Use composite canvas if available, otherwise fallback
            if (!canvasToRecord || !this.videoElement) {
                canvasToRecord = this.renderer.domElement;
            }
            
            if (!canvasToRecord.captureStream) {
                throw new Error('Canvas stream capture not supported');
            }
            
            // Try different MIME types in order of preference
            const mimeTypes = [
                'video/webm;codecs=vp9',
                'video/webm;codecs=vp8',
                'video/webm',
                'video/mp4'
            ];
            
            let selectedMimeType = null;
            for (const mimeType of mimeTypes) {
                if (MediaRecorder.isTypeSupported(mimeType)) {
                    selectedMimeType = mimeType;
                    break;
                }
            }
            
            if (!selectedMimeType) {
                throw new Error('No supported video format found');
            }
            
            // Create stream with appropriate frame rate
            const stream = canvasToRecord.captureStream(30);
            
            // Verify stream has video tracks
            if (!stream.getVideoTracks().length) {
                throw new Error('No video tracks available');
            }
            

            
            this.mediaRecorder = new MediaRecorder(stream, {
                mimeType: selectedMimeType,
                videoBitsPerSecond: 2500000 // 2.5 Mbps
            });

            this.recordedChunks = [];
            
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

            // Start recording with smaller timeslice for better reliability
            this.mediaRecorder.start(1000); // 1 second chunks
            this.isRecording = true;
            
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

    stopRecording() {
        if (this.mediaRecorder && this.isRecording) {
            this.mediaRecorder.stop();
            this.isRecording = false;
            this.resetRecordingUI();
            this.showStatus('Recording stopped');
        }
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
            
            // Determine file extension based on the first chunk's type
            const firstChunk = this.recordedChunks[0];
            let fileExtension = 'webm';
            let mimeType = 'video/webm';
            
            if (firstChunk.type) {
                if (firstChunk.type.includes('mp4')) {
                    fileExtension = 'mp4';
                    mimeType = 'video/mp4';
                }
            }
            
            const blob = new Blob(this.recordedChunks, { type: mimeType });
            
            if (blob.size === 0) {
                throw new Error('Recording is empty');
            }
            
            const url = URL.createObjectURL(blob);
            
            // Create download link
            const link = document.createElement('a');
            link.download = `webAR-recording-${Date.now()}.${fileExtension}`;
            link.href = url;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            // Clean up
            setTimeout(() => {
                URL.revokeObjectURL(url);
            }, 1000);
            
            this.recordedChunks = [];
            
            this.showStatus('Recording saved!');
        } catch (error) {
            console.error('Failed to save recording:', error);
            this.showStatus(`Save failed: ${error.message}`, true);
        }
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