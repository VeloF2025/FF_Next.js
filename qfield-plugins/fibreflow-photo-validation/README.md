# FibreFlow Photo Validation Plugin

Real-time AI validation for fiber installation photos in QField.

## Features

- **Real-time Validation**: Photos are validated against FiberTime standards before saving
- **Work Type Detection**: Automatically detects installation type from layer name
- **Actionable Feedback**: Shows specific issues found and guidance for technicians
- **Offline Mode**: Saves photos for later validation when offline
- **Retry Support**: Easy retake flow for failed validation

## Supported Work Types

| Work Type | Layer Keywords | Validation Checks |
|-----------|---------------|-------------------|
| Pole Installation | pole, poles, mast | Full pole visible, foundation, number label, vertical |
| Cable Stringing | cable, fibre, fiber, span | Cable route, attachment points, slack coil |
| Dome Joint | dome, joint, splice, closure | Enclosure visible, slack brackets, labeling |
| Activation/Drops | drop, activation, customer, ont | Drop route, connection point, drip loop |
| General | (default) | Focus, lighting, framing |

## Installation

### Option 1: Direct Installation

1. Download the plugin ZIP file
2. In QField, go to **Settings → Plugins → Install from file**
3. Select the ZIP file
4. Restart QField

### Option 2: QFieldCloud Integration

1. Upload the plugin to your QFieldCloud organization
2. Enable plugin synchronization in project settings
3. Sync project to device

### Option 3: Manual Installation

1. Extract the plugin folder to:
   - **Android**: `/Android/data/ch.opengis.qfield/files/QField/plugins/`
   - **iOS**: Via Files app → QField → plugins
2. Restart QField

## Configuration

Edit `main.qml` to customize:

```qml
// API endpoint (default: dev server)
property string apiEndpoint: "https://dev.fibreflow.app/api/qfield/validate-photo"

// API key for authentication
property string apiKey: "qfield-validation-key"

// Validation timeout (ms)
property int validationTimeout: 30000

// Auto-detect work type from layer name
property bool autoDetectWorkType: true

// Block save on validation failure
property bool blockOnFailure: false
```

### Production Configuration

For production use, update:

```qml
property string apiEndpoint: "https://app.fibreflow.app/api/qfield/validate-photo"
property string apiKey: "YOUR_PRODUCTION_API_KEY"
```

## Usage

1. Open your QField project
2. Select a layer (poles, cables, domes, or drops)
3. Tap the **blue camera button** in the toolbar
4. Take a photo
5. Wait for validation (1-5 seconds)
6. Review feedback:
   - **Green (Pass)**: Photo meets standards, saved automatically
   - **Red (Fail)**: Shows issues found, option to retake or save anyway

## Validation Flow

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│ Take Photo  │ ──▶ │   Validate   │ ──▶ │ Show Feedback   │
└─────────────┘     │  (1-5 sec)   │     └─────────────────┘
                    └──────────────┘              │
                           │                      ▼
                           │              ┌───────────────┐
                           │              │  Pass? Save   │
                           │              │  Fail? Retake │
                           │              └───────────────┘
                           │
                    ┌──────▼──────┐
                    │   Offline?  │
                    │ Save Later  │
                    └─────────────┘
```

## Requirements

- QField 3.3.0 or later
- Internet connection (for real-time validation)
- GPS enabled (for photo geotagging)

## Troubleshooting

### "GPS position required"
Enable location services and wait for GPS fix before capturing photos.

### "Cannot reach validation server"
- Check internet connection
- Verify API endpoint is accessible
- Check firewall/proxy settings

### "Server error: 401"
API key is invalid. Contact admin for valid key.

### Validation taking too long
- Poor network connection
- Large image file
- Consider reducing camera resolution

## API Response Format

```json
{
  "success": true,
  "data": {
    "valid": false,
    "confidence": 0.75,
    "issues": [
      "Slack coil not visible",
      "Cable attachment unclear"
    ],
    "feedback": "Please retake showing the full slack coil at pole base",
    "suggestRetake": true,
    "processingTimeMs": 1250
  }
}
```

## Development

### Building from Source

```bash
# Clone repository
git clone https://github.com/VelocityFibre/FF_Next.js.git
cd FF_Next.js/qfield-plugins/fibreflow-photo-validation

# Package for distribution
zip -r fibreflow-photo-validation-v1.0.0.zip .
```

### Testing

1. Install on QField desktop build
2. Open test project with photo layers
3. Capture and validate test photos
4. Check console for debug output

## Support

- Documentation: https://docs.fibreflow.app/qfield
- Issues: https://github.com/VelocityFibre/FF_Next.js/issues
- Email: support@fibreflow.app

## License

MIT License - VelocityFibre (Pty) Ltd
