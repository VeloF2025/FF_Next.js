# AI-Enhanced Field Camera - Research & Planning

## Executive Summary

Research into options for providing real-time AI validation feedback to field technicians when capturing fiber installation photos.

**Current State:**
- QField used for field data collection (poles, cables, drops)
- Photos synced to MinIO → QFieldCloud → FibreFlow QA dashboard
- VLM service running on Velocity (Qwen3-VL-8B at :8100)
- Problem: Technicians don't know if photo is acceptable until much later

**Goal:** Real-time or near-real-time AI feedback on photo quality

---

## Option 1: QField Plugin (Recommended First Step)

### Overview
QField 3.3+ has a robust plugin framework using QML + JavaScript that can:
- Access device camera
- Intercept photo capture
- Make HTTP requests to external services
- Modify UI to show feedback

### Approach
Create a QField plugin that:
1. Hooks into photo capture event
2. Sends photo to FibreFlow VLM endpoint
3. Displays pass/fail overlay before saving
4. Optionally blocks poor-quality photos

### Pros
- Native integration with existing QField workflow
- No additional app for technicians
- Cross-platform (Android, iOS)
- Uses existing VLM infrastructure

### Cons
- Requires cellular connectivity in field
- VLM latency (5-15 seconds typical)
- QML/JavaScript learning curve
- Plugin maintenance as QField updates

### Technical Details
```javascript
// QField Plugin Structure (QML + JavaScript)
// Can access: GeometryUtils, FeatureUtils, FileUtils, PlatformUtilities
// Camera access via Snap! plugin pattern
// HTTP requests via XMLHttpRequest
```

### Effort Estimate
- Research & prototype: 2-3 days
- Production plugin: 1-2 weeks
- Testing across devices: 3-5 days

### Sources
- [QField Plugin Documentation](https://docs.qfield.org/reference/plugins/)
- [QField Plugin Blog Post](https://www.opengis.ch/2024/06/18/supercharge-your-fieldwork-with-qfields-project-and-app-wide-plugins/)
- [Snap! Plugin Example](https://github.com/opengisch/qfield-snap)

---

## Option 2: Standalone AI Camera App

### Overview
Build a dedicated camera app (React Native or Flutter) that:
- Captures photos with AI validation
- Exports to QField-compatible folder structure
- Works offline with sync-when-available

### Technology Options

#### React Native Vision Camera
- [react-native-vision-camera](https://github.com/mrousavy/react-native-vision-camera)
- Frame processors for real-time analysis
- 60fps processing capable
- Plugin system for ML models

```typescript
// Frame Processor Example
const frameProcessor = useFrameProcessor((frame) => {
  'worklet';
  const result = validatePhoto(frame);
  if (!result.valid) showFeedback(result.issues);
}, []);
```

#### Flutter + Camera Plugin
- camera_android_camerax
- TFLite integration
- Platform channels for VLM calls

### Pros
- Full control over UX
- Can implement offline validation
- Custom branding and features
- Independent of QField updates

### Cons
- Additional app for technicians to learn
- Need to sync photos to QField manually (or build integration)
- Development and maintenance overhead
- Two apps to maintain

### Effort Estimate
- MVP: 3-4 weeks
- Full app with offline: 6-8 weeks

### Sources
- [React Native Vision Camera](https://react-native-vision-camera.com/docs/guides/frame-processors)
- [NVIDIA Live VLM WebUI](https://github.com/NVIDIA-AI-IOT/live-vlm-webui)

---

## Option 3: On-Device AI (Edge Inference)

### Overview
Run a smaller model directly on the mobile device for instant feedback, without needing connectivity.

### Technology Options

#### LiteRT (TensorFlow Lite successor)
- Google's on-device ML framework
- Optimized for mobile GPUs/NPUs
- Model quantization for size reduction

#### ONNX Runtime Mobile
- Cross-framework compatibility
- Can convert PyTorch models
- Good Android/iOS support

### Approach
1. Distill Qwen3-VL into smaller model for basic checks
2. Or train a lightweight classifier for common issues:
   - Blur detection
   - Lighting quality
   - Framing (is pole in frame)
   - Orientation check
3. Full VLM validation happens server-side later

### Pros
- Instant feedback (< 1 second)
- Works offline
- No cellular data usage
- Privacy (photos don't leave device initially)

### Cons
- Limited model capability vs full VLM
- Model training/maintenance
- Different model per validation type
- Device compatibility issues (older phones)

### Hybrid Approach (Recommended)
- **On-device:** Basic quality checks (blur, lighting, framing)
- **Server-side:** Full VLM semantic validation when connected

### Effort Estimate
- Basic quality model: 2-3 weeks
- Integration: 1 week
- Training pipeline: 2 weeks

### Sources
- [LiteRT (TFLite successor)](https://github.com/google-ai-edge/LiteRT)
- [Mobile AI Frameworks Comparison](https://booleaninc.com/blog/mobile-ai-frameworks-onnx-coreml-tensorflow-lite/)
- [Running Transformers on Mobile](https://huggingface.co/blog/tugrulkaya/running-large-transformer-models-on-mobile)

---

## Option 4: Commercial Solutions

### IQGeo + Deepomatic Lens
- Enterprise-grade utility inspection
- Real-time AI validation in field
- Integration with GIS systems
- **Cons:** Expensive, vendor lock-in

### Fulcrum + AI Inspections
- Mobile data collection platform
- AI-powered inspection features
- **Cons:** Different platform than QField

### Sources
- [IQGeo AI Photo Capture](https://www.iqgeo.com/blog/optimizing-utility-asset-inspections-with-ai-photo-capture)
- [Fulcrum AI Inspections](https://www.fulcrumapp.com/blog/ai-powered-inspections-the-future-of-td-fieldwork/)

---

## Recommended Approach

### Phase 1: QField Plugin MVP (2-3 weeks)
1. Create QField plugin that sends photos to VLM after capture
2. Show simple pass/fail overlay with feedback
3. Allow retry before saving
4. Test with field team

**Why:** Lowest disruption, uses existing tools and infrastructure

### Phase 2: Basic Quality Checks (Optional, 3-4 weeks)
1. Add client-side blur/lighting detection
2. Warn before sending obviously bad photos
3. Reduces unnecessary VLM calls

### Phase 3: Evaluate & Iterate
- Gather feedback from field technicians
- Measure impact on photo quality
- Decide if standalone app needed

---

## Technical Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    FIELD TECHNICIAN                          │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                    QField App                         │   │
│  │  ┌─────────────┐    ┌─────────────────────────────┐  │   │
│  │  │   Camera    │───▶│   AI Validation Plugin      │  │   │
│  │  │   Capture   │    │   ┌───────────────────────┐ │  │   │
│  │  └─────────────┘    │   │ 1. Basic checks      │ │  │   │
│  │                     │   │    (blur, lighting)   │ │  │   │
│  │                     │   │ 2. Send to VLM API   │ │  │   │
│  │                     │   │ 3. Show feedback     │ │  │   │
│  │                     │   │ 4. Allow retry       │ │  │   │
│  │                     │   └───────────────────────┘ │  │   │
│  │                     └─────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────┘   │
│                              │                               │
└──────────────────────────────┼───────────────────────────────┘
                               │ HTTPS
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                    FIBREFLOW BACKEND                         │
│                                                              │
│  ┌─────────────────┐    ┌─────────────────────────────────┐ │
│  │ /api/qfield/    │───▶│  VLM Service (Velocity:8100)    │ │
│  │ validate-photo  │    │  Qwen3-VL-8B-Instruct           │ │
│  │                 │◀───│                                  │ │
│  │  Returns:       │    │  - Validates against FiberTime  │ │
│  │  - valid: bool  │    │  - Returns issues list          │ │
│  │  - confidence   │    │  - Provides feedback text       │ │
│  │  - issues[]     │    │                                  │ │
│  │  - feedback     │    └─────────────────────────────────┘ │
│  └─────────────────┘                                        │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## API Endpoint Design

### New Endpoint: POST /api/qfield/validate-photo

```typescript
// Request
{
  image: string;        // Base64 encoded
  workType: 'pole_installation' | 'cable_stringing' | 'dome_joint' | 'activation';
  projectId?: string;
  featureId?: string;   // Pole number, etc.
}

// Response
{
  valid: boolean;
  confidence: number;   // 0.0 - 1.0
  issues: string[];     // List of problems found
  feedback: string;     // Human-readable guidance
  suggestedRetake: boolean;
}
```

### Latency Target
- P50: < 5 seconds
- P95: < 10 seconds
- Timeout: 30 seconds with graceful degradation

---

## Next Steps

1. **Prototype QField Plugin** - Test if we can intercept photo capture and make HTTP calls
2. **Create lightweight validation endpoint** - Optimized for mobile use (smaller response)
3. **Field test** - Try with one technician, gather feedback
4. **Iterate** - Improve based on real-world usage

---

## Open Questions

1. What's acceptable latency for field technicians? (Will they wait 10 seconds?)
2. Should we block bad photos or just warn?
3. How to handle poor/no connectivity areas?
4. Do we need offline basic checks first?
5. Training data for custom lightweight model?
