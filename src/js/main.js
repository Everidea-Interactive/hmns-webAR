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

        // Add lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(1, 1, 1);
        this.scene.add(directionalLight);
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
            
            // Scale and position the model
            this.model.scale.set(0.1, 0.1, 0.1);
            this.model.position.set(0, 0, 0);
            
            // Add model to anchor
            const anchor = this.mindarThree.addAnchor(0);
            anchor.group.add(this.model);

            // Add animations if available
            if (gltf.animations && gltf.animations.length > 0) {
                this.mixer = new THREE.AnimationMixer(this.model);
                gltf.animations.forEach((clip) => {
                    this.mixer.clipAction(clip).play();
                });
            }

            console.log('3D model loaded successfully');
        } catch (error) {
            console.error('Failed to load 3D model:', error);
            this.showStatus('Failed to load 3D model', true);
        }
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
    }

    async startAR() {
        // Hide loading screen
        document.getElementById('loading-screen').classList.add('hidden');
        
        // Start MindAR
        await this.mindarThree.start();
        
        // Start render loop
        this.render();
    }

    render() {
        requestAnimationFrame(() => this.render());
        
        if (this.mixer) {
            this.mixer.update(0.016); // 60fps
        }
        
        this.renderer.render(this.scene, this.camera);
    }

    takeScreenshot() {
        try {
            const canvas = this.renderer.domElement;
            const dataURL = canvas.toDataURL('image/png');
            
            // Create download link
            const link = document.createElement('a');
            link.download = `webAR-screenshot-${Date.now()}.png`;
            link.href = dataURL;
            link.click();
            
            this.showStatus('Screenshot saved!');
        } catch (error) {
            console.error('Screenshot failed:', error);
            this.showStatus('Screenshot failed', true);
        }
    }

    async startRecording() {
        try {
            const canvas = this.renderer.domElement;
            const stream = canvas.captureStream(30); // 30fps
            
            this.mediaRecorder = new MediaRecorder(stream, {
                mimeType: 'video/webm;codecs=vp9'
            });

            this.recordedChunks = [];
            
            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.recordedChunks.push(event.data);
                }
            };

            this.mediaRecorder.onstop = () => {
                this.saveRecording();
            };

            this.mediaRecorder.start();
            this.isRecording = true;
            
            // Update UI
            document.getElementById('record-btn').classList.add('hidden');
            document.getElementById('stop-record-btn').classList.remove('hidden');
            document.getElementById('record-btn').classList.add('recording');
            
            this.showStatus('Recording started');
            
        } catch (error) {
            console.error('Recording failed to start:', error);
            this.showStatus('Recording failed to start', true);
        }
    }

    stopRecording() {
        if (this.mediaRecorder && this.isRecording) {
            this.mediaRecorder.stop();
            this.isRecording = false;
            
            // Update UI
            document.getElementById('record-btn').classList.remove('hidden', 'recording');
            document.getElementById('stop-record-btn').classList.add('hidden');
            
            this.showStatus('Recording stopped');
        }
    }

    saveRecording() {
        try {
            const blob = new Blob(this.recordedChunks, { type: 'video/webm' });
            const url = URL.createObjectURL(blob);
            
            // Create download link
            const link = document.createElement('a');
            link.download = `webAR-recording-${Date.now()}.webm`;
            link.href = url;
            link.click();
            
            // Clean up
            URL.revokeObjectURL(url);
            this.recordedChunks = [];
            
            this.showStatus('Recording saved!');
        } catch (error) {
            console.error('Failed to save recording:', error);
            this.showStatus('Failed to save recording', true);
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