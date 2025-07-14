# WebAR Application with MindAR

A modern WebAR application built with MindAR.js and Three.js that displays 3D models when detecting image targets, with screenshot and recording capabilities.

## Features

- 📱 **Image Tracking**: Uses MindAR.js for robust image target detection
- 🎯 **3D Model Display**: Renders GLTF 3D models on detected targets
- 📸 **Screenshot Function**: Capture and download AR scenes
- 🎥 **Video Recording**: Record and share AR experiences
- 📱 **Mobile Responsive**: Works on desktop and mobile devices
- ✨ **Modern UI**: Clean, intuitive interface with smooth animations

## Project Structure

```
hmns-webAR/
├── index.html              # Main HTML file
├── src/
│   ├── styles/
│   │   └── main.css        # Application styles
│   ├── js/
│   │   └── main.js         # Main application logic
│   └── assets/
│       ├── image_targets/
│       │   └── targets.mind # MindAR target file
│       └── models/
│           └── softmind/    # 3D model files
│               ├── scene.gltf
│               ├── scene.bin
│               └── textures/
└── README.md
```

## How to Use

1. **Setup**: Open `index.html` in a web browser (requires HTTPS for camera access)
2. **Allow Camera**: Grant camera permission when prompted
3. **Point Camera**: Aim your camera at the target image
4. **View 3D Model**: The 3D model will appear when the target is detected
5. **Capture**: Use the camera button to take screenshots
6. **Record**: Use the record button to capture video of your AR experience

## Technical Implementation

### Core Technologies

- **MindAR.js**: Image tracking and AR functionality
- **Three.js**: 3D rendering and scene management
- **WebRTC MediaRecorder**: Video recording capabilities
- **ES6 Modules**: Modern JavaScript architecture

### Key Components

#### WebARApp Class

- Manages the complete AR application lifecycle
- Handles MindAR initialization and 3D scene setup
- Implements screenshot and recording functionality

#### 3D Model Loading

- Uses GLTFLoader for importing 3D models
- Supports animations and textures
- Automatic scaling and positioning

#### UI Controls

- Floating action buttons for screenshots and recording
- Status notifications for user feedback
- Responsive design for mobile devices

## Browser Compatibility

- Chrome 88+ (recommended)
- Firefox 85+
- Safari 14+ (iOS/macOS)
- Edge 88+

**Note**: HTTPS is required for camera access. Use a local server for development.

## Development

To run locally with HTTPS:

```bash
# Using Python 3
python -m http.server 8000

# Using Node.js http-server
npx http-server -p 8000 --ssl

# Using Live Server (VS Code extension)
# Right-click index.html → "Open with Live Server"
```

## Customization

### Adding New 3D Models

1. Place GLTF files in `src/assets/models/`
2. Update the model path in `main.js`
3. Adjust scale and position as needed

### Creating Image Targets

1. Use MindAR Studio to create `.mind` files
2. Replace `src/assets/image_targets/targets.mind`
3. Update target reference in code if needed

## Performance Tips

- Use optimized GLTF models (Draco compression recommended)
- Keep texture sizes reasonable (1024x1024 or smaller)
- Test on target devices for performance validation
- Use appropriate lighting for better tracking

## Troubleshooting

### Camera Not Working

- Ensure HTTPS is enabled
- Check browser permissions
- Try different browsers

### Model Not Appearing

- Verify GLTF file paths
- Check browser console for errors
- Ensure target image is well-lit and visible

### Poor Tracking

- Use high-contrast target images
- Ensure good lighting conditions
- Keep target image flat and unobstructed

## License

This project is open source and available under the MIT License.
