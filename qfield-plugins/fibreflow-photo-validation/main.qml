import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import org.qfield
import org.qgis
import Theme

/**
 * FibreFlow Photo Validation Plugin
 *
 * Real-time AI validation for fiber installation photos.
 * Validates photos against FiberTime standards before saving.
 *
 * Features:
 * - Automatic work type detection from layer name
 * - Real-time VLM validation via FibreFlow API
 * - Pass/fail feedback with actionable issues
 * - Offline mode with deferred validation
 * - Retry capability for failed photos
 */
Item {
    id: plugin

    // ========== CONFIGURATION ==========

    // FibreFlow API endpoint - change for production
    property string apiEndpoint: "https://dev.fibreflow.app/api/qfield/validate-photo"

    // API key for authentication
    property string apiKey: "qfield-validation-key"

    // Validation timeout in milliseconds
    property int validationTimeout: 30000

    // Auto-detect work type from layer name
    property bool autoDetectWorkType: true

    // Block save on validation failure (vs just warn)
    property bool blockOnFailure: false

    // ========== INTERNAL STATE ==========

    property var positionSource: iface.findItemByObjectName('positionSource')
    property var dashBoard: iface.findItemByObjectName('dashBoard')
    property var overlayFeatureFormDrawer: iface.findItemByObjectName('overlayFeatureFormDrawer')

    property string currentImagePath: ""
    property string currentWorkType: "general"
    property bool isValidating: false
    property var lastValidationResult: null

    // Work type mappings based on layer names
    property var workTypePatterns: {
        "pole": "pole_installation",
        "poles": "pole_installation",
        "mast": "pole_installation",
        "cable": "cable_stringing",
        "fibre": "cable_stringing",
        "fiber": "cable_stringing",
        "span": "cable_stringing",
        "dome": "dome_joint",
        "joint": "dome_joint",
        "splice": "dome_joint",
        "closure": "dome_joint",
        "drop": "activation",
        "activation": "activation",
        "customer": "activation",
        "ont": "activation"
    }

    // ========== INITIALIZATION ==========

    Component.onCompleted: {
        // Add validation button to toolbar
        iface.addItemToPluginsToolbar(validationToolbarButton)

        // Show loaded message
        iface.mainWindow().displayToast("FibreFlow Photo Validation loaded")

        console.log("[FibreFlow] Plugin initialized, endpoint:", apiEndpoint)
    }

    // ========== TOOLBAR BUTTON ==========

    QfToolButton {
        id: validationToolbarButton
        iconSource: Theme.getThemeVectorIcon("ic_camera_photo_white_24dp")
        iconColor: "white"
        bgcolor: "#2563eb" // FibreFlow blue
        round: true

        onClicked: {
            // Check GPS
            if (!positionSource || !positionSource.positionInformation ||
                !positionSource.positionInformation.latitudeValid) {
                iface.mainWindow().displayToast("GPS position required for photo capture")
                return
            }

            // Detect work type from active layer
            detectWorkType()

            // Launch camera
            cameraLoader.active = true
        }

        ToolTip.visible: hovered
        ToolTip.text: "Capture validated photo"
    }

    // ========== CAMERA LOADER ==========

    Loader {
        id: cameraLoader
        active: false
        sourceComponent: QFieldCamera {
            id: camera

            onFinished: function(imagePath) {
                cameraLoader.active = false

                if (imagePath && imagePath.length > 0) {
                    currentImagePath = imagePath
                    console.log("[FibreFlow] Photo captured:", imagePath)

                    // Start validation
                    validatePhoto(imagePath)
                }
            }

            onCanceled: {
                cameraLoader.active = false
                console.log("[FibreFlow] Camera canceled")
            }
        }
    }

    // ========== VALIDATION OVERLAY ==========

    Rectangle {
        id: validationOverlay
        parent: iface.mainWindow().contentItem
        anchors.fill: parent
        color: "#000000CC"
        visible: isValidating
        z: 1000

        MouseArea {
            anchors.fill: parent
            // Block interaction while validating
        }

        ColumnLayout {
            anchors.centerIn: parent
            spacing: 20

            BusyIndicator {
                Layout.alignment: Qt.AlignHCenter
                running: isValidating
                palette.dark: "#2563eb"
            }

            Text {
                Layout.alignment: Qt.AlignHCenter
                text: "Validating photo..."
                color: "white"
                font.pixelSize: 18
                font.bold: true
            }

            Text {
                Layout.alignment: Qt.AlignHCenter
                text: "Checking against FiberTime standards"
                color: "#9CA3AF"
                font.pixelSize: 14
            }
        }
    }

    // ========== RESULT DIALOG ==========

    Dialog {
        id: resultDialog
        parent: iface.mainWindow().contentItem
        anchors.centerIn: parent
        width: Math.min(parent.width * 0.9, 400)
        modal: true

        property bool isValid: false
        property real confidence: 0
        property var issues: []
        property string feedback: ""
        property bool suggestRetake: false

        header: Rectangle {
            width: parent.width
            height: 60
            color: resultDialog.isValid ? "#10B981" : "#EF4444"

            RowLayout {
                anchors.fill: parent
                anchors.margins: 15

                Text {
                    text: resultDialog.isValid ? "✓" : "✗"
                    color: "white"
                    font.pixelSize: 24
                    font.bold: true
                }

                Text {
                    Layout.fillWidth: true
                    text: resultDialog.isValid ? "Photo Validated" : "Validation Failed"
                    color: "white"
                    font.pixelSize: 18
                    font.bold: true
                }

                Text {
                    text: Math.round(resultDialog.confidence * 100) + "%"
                    color: "white"
                    font.pixelSize: 16
                    opacity: 0.9
                }
            }
        }

        contentItem: ColumnLayout {
            spacing: 15

            // Feedback message
            Text {
                Layout.fillWidth: true
                text: resultDialog.feedback
                wrapMode: Text.WordWrap
                color: "#374151"
                font.pixelSize: 14
            }

            // Issues list
            Repeater {
                model: resultDialog.issues

                RowLayout {
                    Layout.fillWidth: true
                    spacing: 8

                    Rectangle {
                        width: 6
                        height: 6
                        radius: 3
                        color: "#EF4444"
                    }

                    Text {
                        Layout.fillWidth: true
                        text: modelData
                        wrapMode: Text.WordWrap
                        color: "#6B7280"
                        font.pixelSize: 13
                    }
                }
            }
        }

        footer: DialogButtonBox {
            Button {
                text: resultDialog.suggestRetake ? "Retake" : "OK"
                DialogButtonBox.buttonRole: DialogButtonBox.AcceptRole

                background: Rectangle {
                    color: resultDialog.isValid ? "#10B981" : "#2563eb"
                    radius: 6
                }

                contentItem: Text {
                    text: parent.text
                    color: "white"
                    font.bold: true
                    horizontalAlignment: Text.AlignHCenter
                }
            }

            Button {
                text: "Save Anyway"
                visible: !resultDialog.isValid && !blockOnFailure
                DialogButtonBox.buttonRole: DialogButtonBox.RejectRole

                background: Rectangle {
                    color: "#6B7280"
                    radius: 6
                }

                contentItem: Text {
                    text: parent.text
                    color: "white"
                    horizontalAlignment: Text.AlignHCenter
                }
            }
        }

        onAccepted: {
            if (resultDialog.isValid) {
                // Save the photo
                savePhotoToFeature()
            } else if (resultDialog.suggestRetake) {
                // Delete failed photo and retake
                deletePhoto(currentImagePath)
                cameraLoader.active = true
            }
        }

        onRejected: {
            // Save anyway (if allowed)
            if (!blockOnFailure) {
                savePhotoToFeature()
            }
        }
    }

    // ========== OFFLINE DIALOG ==========

    Dialog {
        id: offlineDialog
        parent: iface.mainWindow().contentItem
        anchors.centerIn: parent
        width: Math.min(parent.width * 0.9, 350)
        modal: true
        title: "No Connection"

        contentItem: Text {
            text: "Cannot reach validation server. Save photo for later validation?"
            wrapMode: Text.WordWrap
            color: "#374151"
        }

        standardButtons: Dialog.Yes | Dialog.No

        onAccepted: {
            // Save without validation
            savePhotoToFeature()
            iface.mainWindow().displayToast("Photo saved (pending validation)")
        }

        onRejected: {
            deletePhoto(currentImagePath)
        }
    }

    // ========== CORE FUNCTIONS ==========

    function detectWorkType() {
        if (!autoDetectWorkType || !dashBoard || !dashBoard.activeLayer) {
            currentWorkType = "general"
            return
        }

        let layerName = dashBoard.activeLayer.name.toLowerCase()

        for (let pattern in workTypePatterns) {
            if (layerName.includes(pattern)) {
                currentWorkType = workTypePatterns[pattern]
                console.log("[FibreFlow] Detected work type:", currentWorkType, "from layer:", layerName)
                return
            }
        }

        currentWorkType = "general"
        console.log("[FibreFlow] Using default work type: general")
    }

    function validatePhoto(imagePath) {
        isValidating = true
        // Use async image loading and canvas conversion
        loadImageAndValidate(imagePath)
    }

    function handleValidationResult(result) {
        console.log("[FibreFlow] Validation result:", JSON.stringify(result))

        lastValidationResult = result

        // Quick feedback via toast
        if (result.valid) {
            iface.mainWindow().displayToast("✓ Photo validated")
        }

        // Show detailed dialog
        resultDialog.isValid = result.valid
        resultDialog.confidence = result.confidence || 0
        resultDialog.issues = result.issues || []
        resultDialog.feedback = result.feedback || ""
        resultDialog.suggestRetake = result.suggestRetake || false
        resultDialog.open()
    }

    function savePhotoToFeature() {
        // Find photo field in active layer
        if (!dashBoard || !dashBoard.activeLayer) {
            iface.mainWindow().displayToast("No active layer")
            return
        }

        // Create new feature with photo
        let feature = dashBoard.activeLayer.createFeature()

        // Set geometry from GPS
        if (positionSource && positionSource.positionInformation) {
            let point = GeometryUtils.createPointFromLatLon(
                positionSource.positionInformation.latitude,
                positionSource.positionInformation.longitude
            )
            feature.geometry = point
        }

        // Find photo field
        let photoField = findPhotoField(dashBoard.activeLayer)
        if (photoField) {
            feature.setAttribute(photoField, currentImagePath)
        }

        // Open feature form for additional attributes
        overlayFeatureFormDrawer.featureModel.feature = feature
        overlayFeatureFormDrawer.open()

        iface.mainWindow().displayToast("Photo attached to feature")
    }

    function findPhotoField(layer) {
        let candidates = ["photo", "picture", "image", "media", "camera", "attachment", "foto"]
        let fields = layer.fields

        for (let i = 0; i < fields.count; i++) {
            let fieldName = fields.at(i).name.toLowerCase()
            for (let candidate of candidates) {
                if (fieldName.includes(candidate)) {
                    return fields.at(i).name
                }
            }
        }

        // Try to find any text field as fallback
        for (let i = 0; i < fields.count; i++) {
            if (fields.at(i).type === 10) { // QString type
                return fields.at(i).name
            }
        }

        return null
    }

    // ========== IMAGE PROCESSING ==========

    // Hidden Image element for loading photos
    Image {
        id: imageLoader
        visible: false
        asynchronous: false
        cache: false

        property var callback: null

        onStatusChanged: {
            if (status === Image.Ready && callback) {
                // Use canvas to convert to base64
                imageCanvas.requestPaint()
            } else if (status === Image.Error) {
                console.log("[FibreFlow] Failed to load image")
                isValidating = false
                iface.mainWindow().displayToast("Failed to load image")
            }
        }
    }

    // Canvas for converting image to base64
    Canvas {
        id: imageCanvas
        visible: false
        width: imageLoader.implicitWidth
        height: imageLoader.implicitHeight

        onPaint: {
            if (imageLoader.status !== Image.Ready) return

            let ctx = getContext("2d")
            ctx.drawImage(imageLoader, 0, 0)

            // Get data URL (includes base64)
            let dataUrl = toDataURL("image/jpeg", 0.85)

            // Extract base64 part (remove "data:image/jpeg;base64," prefix)
            let base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "")

            console.log("[FibreFlow] Image converted to base64, length:", base64.length)

            // Call the callback with base64 data
            if (imageLoader.callback) {
                imageLoader.callback(base64)
                imageLoader.callback = null
            }
        }
    }

    function loadImageAndValidate(imagePath) {
        console.log("[FibreFlow] Loading image for validation:", imagePath)

        imageLoader.callback = function(base64Data) {
            sendValidationRequest(base64Data)
        }

        // Load the image (triggers onStatusChanged)
        imageLoader.source = ""  // Reset first
        imageLoader.source = "file://" + imagePath
    }

    function sendValidationRequest(imageData) {
        if (!imageData || imageData.length === 0) {
            isValidating = false
            iface.mainWindow().displayToast("Failed to process image")
            return
        }

        // Create request
        let xhr = new XMLHttpRequest()

        // Set timeout
        let timeoutId = Qt.createQmlObject(
            'import QtQuick; Timer { interval: ' + validationTimeout + '; running: true; repeat: false }',
            plugin
        )
        timeoutId.triggered.connect(function() {
            if (isValidating) {
                xhr.abort()
                isValidating = false
                offlineDialog.open()
            }
        })

        xhr.onreadystatechange = function() {
            if (xhr.readyState === XMLHttpRequest.DONE) {
                timeoutId.destroy()
                isValidating = false

                if (xhr.status === 200) {
                    try {
                        let response = JSON.parse(xhr.responseText)
                        handleValidationResult(response.data || response)
                    } catch (e) {
                        console.log("[FibreFlow] Parse error:", e)
                        iface.mainWindow().displayToast("Invalid server response")
                        offlineDialog.open()
                    }
                } else if (xhr.status === 0) {
                    console.log("[FibreFlow] Network error")
                    offlineDialog.open()
                } else {
                    console.log("[FibreFlow] Server error:", xhr.status)
                    iface.mainWindow().displayToast("Server error: " + xhr.status)
                    offlineDialog.open()
                }
            }
        }

        xhr.open("POST", apiEndpoint, true)
        xhr.setRequestHeader("Content-Type", "application/json")
        xhr.setRequestHeader("X-API-Key", apiKey)

        let payload = {
            image: imageData,
            workType: currentWorkType,
            projectId: dashBoard && dashBoard.activeLayer ? dashBoard.activeLayer.id : "",
            featureId: ""
        }

        console.log("[FibreFlow] Sending validation request, workType:", currentWorkType, "imageSize:", imageData.length)
        xhr.send(JSON.stringify(payload))
    }

    function deletePhoto(imagePath) {
        try {
            FileUtils.removeFile(imagePath)
            console.log("[FibreFlow] Deleted photo:", imagePath)
        } catch (e) {
            console.log("[FibreFlow] Error deleting photo:", e)
        }
    }
}
