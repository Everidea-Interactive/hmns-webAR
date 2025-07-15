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
            
            console.log('Model dimensions:', size);
            console.log('Model center:', center);
            
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
                console.log('Target found - model appearing');
                this.onTargetFound();
            };
            
            anchor.onTargetLost = () => {
                console.log('Target lost - model disappearing');
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

            console.log('3D model loaded and positioned successfully');
            console.log('Final scale:', scale);
            console.log('Final position:', this.model.position);
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
        
        // Animation parameters for stability
        this.floatAmplitude = 0.015; // Reduced for more stability
        this.floatSpeed = 1.5; // Slower floating
        this.rotationSpeed = 0.3; // Very slow rotation
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
        
        // Reset animation timing for smooth start
        this.floatTime = 0;
        this.rotationTime = 0;
        
        // Smooth fade-in effect for the model
        if (this.model) {
            this.model.traverse((child) => {
                if (child.isMesh && child.material) {
                    // Store original opacity
                    if (!child.material.userData.originalOpacity) {
                        child.material.userData.originalOpacity = child.material.opacity || 1.0;
                    }
                    // Start from transparent
                    child.material.transparent = true;
                    child.material.opacity = 0;
                }
            });
        }
    }

    onTargetLost() {
        this.isTargetVisible = false;
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
        
        // Debug: Add double-tap on instructions to show debug info
        document.getElementById('instructions').addEventListener('dblclick', () => {
            this.showDebugInfo();
        });
    }

    showDebugInfo() {
        console.log('=== DEBUG INFO ===');
        console.log('Video element:', this.videoElement);
        console.log('Video playing:', this.videoElement ? !this.videoElement.paused : 'no video');
        
        if (this.videoElement) {
            const videoAspect = this.videoElement.videoWidth / this.videoElement.videoHeight;
            console.log('Video dimensions:', `${this.videoElement.videoWidth}x${this.videoElement.videoHeight} (aspect: ${videoAspect.toFixed(2)})`);
        }
        
        console.log('Renderer canvas:', this.renderer.domElement);
        const rendererAspect = this.renderer.domElement.width / this.renderer.domElement.height;
        console.log('Renderer canvas size:', `${this.renderer.domElement.width}x${this.renderer.domElement.height} (aspect: ${rendererAspect.toFixed(2)})`);
        
        console.log('Composite canvas:', this.compositeCanvas);
        if (this.compositeCanvas) {
            const compositeAspect = this.compositeCanvas.width / this.compositeCanvas.height;
            console.log('Composite canvas size:', `${this.compositeCanvas.width}x${this.compositeCanvas.height} (aspect: ${compositeAspect.toFixed(2)})`);
        }
        
        // Container info
        const container = document.querySelector('#ar-container');
        const containerRect = container.getBoundingClientRect();
        const containerAspect = containerRect.width / containerRect.height;
        console.log('Container size:', `${containerRect.width}x${containerRect.height} (aspect: ${containerAspect.toFixed(2)})`);
        
        // Try to capture from different sources
        const rendererCanvas = this.renderer.domElement;
        const rendererDataURL = rendererCanvas.toDataURL('image/png').substring(0, 100);
        console.log('Renderer canvas data preview:', rendererDataURL);
        
        if (this.compositeCanvas) {
            const compositeDataURL = this.compositeCanvas.toDataURL('image/png').substring(0, 100);
            console.log('Composite canvas data preview:', compositeDataURL);
        }
        
        this.showStatus('Debug info logged to console');
    }

    async startAR() {
        // Hide loading screen
        document.getElementById('loading-screen').classList.add('hidden');
        
        // Start MindAR
        await this.mindarThree.start();
        
        // Setup composite canvas for media capture
        this.setupCompositeCanvas();
        
        // Log canvas information for debugging
        console.log('Canvas element:', this.renderer.domElement);
        console.log('Canvas size:', this.renderer.domElement.width, 'x', this.renderer.domElement.height);
        console.log('Renderer context:', this.renderer.getContext());
        
        // Start render loop
        this.render();
    }

    setupCompositeCanvas() {
        // Wait a bit for MindAR to fully initialize
        setTimeout(() => {
            // Get the video element from MindAR
            const container = document.querySelector('#ar-container');
            this.videoElement = container.querySelector('video');
            
            if (!this.videoElement) {
                console.warn('Video element not found, using fallback method');
                return;
            }

            // Create a composite canvas for combining video and 3D content
            this.compositeCanvas = document.createElement('canvas');
            this.compositeCtx = this.compositeCanvas.getContext('2d');
            
            this.updateCanvasSize();
            
            // Add resize listener for responsive behavior
            window.addEventListener('resize', () => {
                this.updateCanvasSize();
            });
            
            // Add orientation change listener
            window.addEventListener('orientationchange', () => {
                setTimeout(() => {
                    this.updateCanvasSize();
                }, 100);
            });
            
            console.log('Composite canvas setup with responsive sizing');
        }, 1000);
    }

    updateCanvasSize() {
        if (!this.compositeCanvas) return;
        
        const container = document.querySelector('#ar-container');
        const containerRect = container.getBoundingClientRect();
        const rendererCanvas = this.renderer.domElement;
        
        // Get device pixel ratio for high-DPI displays
        const pixelRatio = window.devicePixelRatio || 1;
        
        // Calculate optimal dimensions based on screen size
        const screenWidth = window.innerWidth;
        const screenHeight = window.innerHeight;
        
        let targetWidth, targetHeight;
        
        if (screenWidth <= 480) {
            // Small mobile
            targetWidth = Math.min(screenWidth * pixelRatio, 1280);
            targetHeight = Math.min(screenHeight * pixelRatio, 720);
        } else if (screenWidth <= 768) {
            // Tablet/larger mobile
            targetWidth = Math.min(screenWidth * pixelRatio, 1920);
            targetHeight = Math.min(screenHeight * pixelRatio, 1080);
        } else {
            // Desktop
            targetWidth = Math.min(containerRect.width * pixelRatio, 1920);
            targetHeight = Math.min(containerRect.height * pixelRatio, 1080);
        }
        
        // Ensure minimum quality
        targetWidth = Math.max(targetWidth, 640);
        targetHeight = Math.max(targetHeight, 480);
        
        this.compositeCanvas.width = targetWidth;
        this.compositeCanvas.height = targetHeight;
        
        console.log('Canvas size updated:', {
            composite: `${this.compositeCanvas.width}x${this.compositeCanvas.height}`,
            container: `${containerRect.width}x${containerRect.height}`,
            screen: `${screenWidth}x${screenHeight}`,
            pixelRatio: pixelRatio
        });
    }

    render() {
        requestAnimationFrame(() => this.render());
        
        if (this.mixer) {
            this.mixer.update(0.016); // 60fps
        }
        
        // Update smooth and stable animations
        if (this.model && this.initialModelY !== undefined) {
            const deltaTime = 0.016; // 60fps
            
            // Handle fade-in/fade-out based on target visibility
            if (this.isTargetVisible) {
                // Fade in model when target is found
                this.model.traverse((child) => {
                    if (child.isMesh && child.material && child.material.userData.originalOpacity) {
                        const targetOpacity = child.material.userData.originalOpacity;
                        child.material.opacity = Math.min(targetOpacity, child.material.opacity + deltaTime * 3); // 3x speed fade in
                    }
                });
                
                // Smooth floating animation (only when visible)
                this.floatTime += deltaTime;
                const floatOffset = Math.sin(this.floatTime * this.floatSpeed) * this.floatAmplitude;
                this.model.position.y = this.initialModelY + floatOffset;
                
                // Smooth rotation animation (very slow to maintain camera-facing)
                this.rotationTime += deltaTime;
                const rotationOffset = Math.sin(this.rotationTime * this.rotationSpeed) * 0.1; // Small rotation variation
                this.model.rotation.y = this.initialModelRotationY + rotationOffset;
                
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
        if (!this.compositeCanvas || !this.videoElement || !this.compositeCtx) {
            console.log('Missing composite elements:', {
                canvas: !!this.compositeCanvas,
                video: !!this.videoElement,
                ctx: !!this.compositeCtx
            });
            return;
        }

        try {
            // Clear composite canvas
            this.compositeCtx.clearRect(0, 0, this.compositeCanvas.width, this.compositeCanvas.height);
            
            // Check video state
            console.log('Video state:', {
                width: this.videoElement.videoWidth,
                height: this.videoElement.videoHeight,
                paused: this.videoElement.paused,
                ended: this.videoElement.ended,
                readyState: this.videoElement.readyState
            });
            
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
            
            // Draw 3D content on top
            const rendererCanvas = this.renderer.domElement;
            if (rendererCanvas.width > 0 && rendererCanvas.height > 0) {
                this.compositeCtx.globalCompositeOperation = 'source-over';
                try {
                    this.compositeCtx.drawImage(
                        rendererCanvas,
                        0, 0,
                        this.compositeCanvas.width,
                        this.compositeCanvas.height
                    );
                    console.log('3D content drawn successfully');
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
            // Simple approach first - just draw the video
            ctx.drawImage(
                video,
                0, 0,
                canvas.width,
                canvas.height
            );
            
            // Log success for debugging
            console.log('Video drawn successfully');
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
            console.log('Taking screenshot...');
            
            // Try multiple methods in order of preference
            if (this.videoElement && this.compositeCanvas) {
                console.log('Trying composite canvas method');
                this.updateCompositeCanvas();
                this.captureFromCanvas(this.compositeCanvas, 'composite');
            } else if (this.videoElement) {
                console.log('Trying direct video capture method');
                this.captureFromVideo();
            } else {
                console.log('Using renderer canvas fallback');
                this.renderer.clear();
                this.renderer.render(this.scene, this.camera);
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
                console.log(`${method} canvas data URL length:`, dataURL.length);
                
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
            
            tempCanvas.width = this.videoElement.videoWidth || 1280;
            tempCanvas.height = this.videoElement.videoHeight || 720;
            
            tempCtx.drawImage(this.videoElement, 0, 0, tempCanvas.width, tempCanvas.height);
            
            const dataURL = tempCanvas.toDataURL('image/png', 1.0);
            console.log('Video capture data URL length:', dataURL.length);
            
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
                console.log('Using fallback method for recording');
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
            
            console.log('Recording canvas:', canvasToRecord === this.compositeCanvas ? 'composite' : 'renderer');
            console.log('Stream tracks:', stream.getVideoTracks().length);
            
            this.mediaRecorder = new MediaRecorder(stream, {
                mimeType: selectedMimeType,
                videoBitsPerSecond: 2500000 // 2.5 Mbps
            });

            this.recordedChunks = [];
            
            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data && event.data.size > 0) {
                    this.recordedChunks.push(event.data);
                    console.log('Recording chunk:', event.data.size, 'bytes');
                }
            };

            this.mediaRecorder.onstop = () => {
                console.log('Recording stopped, chunks:', this.recordedChunks.length);
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
            console.log('Recording started with MIME type:', selectedMimeType);
            
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

            console.log('Saving recording with', this.recordedChunks.length, 'chunks');
            
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
            console.log('Created blob:', blob.size, 'bytes, type:', blob.type);
            
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