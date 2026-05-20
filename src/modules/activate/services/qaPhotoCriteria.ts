/**
 * QA Photo Criteria - Per-step visual pass/fail rules
 *
 * This string is injected into the VLM categorization prompt so every
 * categorization call has explicit pass/fail criteria per step.
 *
 * Updated as new photo examples are reviewed with the QA team.
 * Last updated: 2026-05-19
 */

export const QA_PHOTO_CRITERIA = `
STEP-BY-STEP PHOTO QUALITY CRITERIA:
The following rules define what makes a photo CORRECT (pass) or INCORRECT (fail) for each step.
Apply these criteria when categorizing AND when assessing photo quality.

--- STEP 8: Final Installation ---
A CORRECT Step 8 photo MUST show ALL of the following:
  ✅ Wide shot — the full setup is visible, not a close-up
  ✅ White Fibertime/Nokia router is clearly visible
  ✅ Black ONT is visible (typically mounted behind or below the router)
  ✅ Cables are visible and physically traced to a power outlet
  ✅ Power outlet IS visible in the frame

A Step 8 photo is INCORRECT (mark as FAIL, reason below) if ANY of the following are true:
  ❌ Power outlet is NOT visible in the frame → reason: "Power outlet not in view"
  ❌ Cables are not shown connected or do not lead to a visible power outlet → reason: "Cables not connected to visible power outlet"
  ❌ Photo is a close-up of the router face only (even if lights are on) → reason: "Close-up shot — full installation setup not visible"
  ❌ Black ONT is not visible in the frame → reason: "ONT not visible in frame"
  ❌ Only the router front panel is shown without showing the wall/cable/outlet context → reason: "Missing installation context — power outlet and ONT must be visible"

IMPORTANT: A photo showing a router with green lights but NO visible power outlet is NOT a valid Step 8 photo, even if it looks like a final installation. The power outlet being in-frame is mandatory proof that the installation is complete and powered correctly.

--- STEP 9: Green Lights on ONT ---
A CORRECT Step 9 photo MUST show ALL of the following:
  ✅ The white Fibertime/Nokia router is the main subject (front panel in focus)
  ✅ All 4 indicator lights on the white router are visibly ON/blinking (green)
  ✅ The black ONT box may be visible behind/above the white router — this is fine

A Step 9 photo is INCORRECT (mark as FAIL, reason below) if ANY of the following are true:
  ❌ Fewer than 4 lights are active on the white router → reason: "Not all lights in view"
  ❌ The lights on the white router are off or not clearly visible → reason: "Not all lights in view"
  ❌ Only the black ONT is shown without the white router's front panel → reason: "Not all lights in view"

DO NOT confuse Step 9 with Step 8:
  - Step 9 = close-up focused on white router FRONT PANEL with all 4 lights ON. No power outlet required.
  - Step 8 = WIDE shot showing the full setup INCLUDING the power outlet and cables running to it.
  - A photo with visible lights but NO power outlet in frame = Step 9 check (not a failed Step 8).
  - A photo with a power outlet and cables visible = Step 8 check (not Step 9).

--- STEP 6: ONT Back After Install ---
A CORRECT Step 6 photo MUST show ALL of the following:
  ✅ The FULL back panel of the white Nokia/Fibertime ONT is visible (ports, vents, labels all in frame)
  ✅ A GREEN fiber cable is clearly and visibly plugged into the fiber port on the back of the ONT
  ✅ The green cable must be unambiguously green — not white, black, or grey

A Step 6 photo is INCORRECT (mark as FAIL, reason below) if ANY of the following are true:
  ❌ No green cable is visible plugged into the fiber port → reason: "Green fiber cable not visible on back of ONT"
  ❌ The fiber port is empty or obscured → reason: "Green fiber cable not visible on back of ONT"
  ❌ The full back panel of the ONT is not in frame (cut off, angled away, too close) → reason: "Full back of ONT not visible"
  ❌ Only a power/white/black cable is visible but no green fiber cable → reason: "Green fiber cable not visible on back of ONT"
  ❌ The photo shows the FRONT of the ONT instead of the back → reason: "Back of ONT not shown"

The green fiber cable plugged into the fiber port is the ONLY proof that the ONT is connected to the network. Without it, the photo does not confirm a completed installation.

--- STEP 4: Cable Entry Inside ---
A CORRECT Step 4 photo MUST show ALL of the following:
  ✅ The scene is clearly INDOORS — interior wall surfaces, interior ceiling, or roof structure visible
  ✅ Strong indoor indicators (any one is sufficient):
     • Interior ceiling trim, white ceiling, or painted interior wall visible
     • Wooden roof rafters, shutters, or roof beams visible at the top of the photo
     • Multiple interior walls meeting at a corner
     • Smooth plastered/painted interior wall finish
  ✅ Cable visible routing along or entering through the interior wall
  ✅ A white silicone/sealant blob at the cable entry hole is a strong positive indicator (but NOT required if indoor setting is otherwise clear)

A Step 4 photo is INCORRECT if:
  ❌ Sky is visible anywhere in the frame → this is Step 3 (outside), not Step 4
  ❌ Corrugated steel/zinc roof visible → outside indicator, classify as Step 3
  ❌ A J-hook or pigtail screw is visible holding the cable to the wall → ALWAYS Step 3 (outside), never Step 4
  ❌ Rough, worn, scuffed exterior wall texture with no indoor ceiling or indoor wall finish → Step 3

--- STEP 3: Cable Entry Outside ---
A CORRECT Step 3 photo MUST show ALL of the following:
  ✅ The scene is clearly OUTDOORS — exterior wall, open sky, corrugated roof, or outdoor materials visible
  ✅ Strong outdoor indicators (any one is sufficient):
     • Blue sky visible (even through small gaps between roof and wall)
     • Corrugated steel/zinc roof visible
     • Worn, scuffed, rough exterior wall surface (concrete, roughcast, unpainted exterior plaster)
     • A J-hook or pigtail screw mounting the cable to the wall — this is an ABSOLUTE outdoor indicator
  ✅ Cable visible running along or entering the exterior wall

ABSOLUTE RULE — J-hook / pigtail screw:
  If a cable is mounted to a wall via a J-hook or pigtail screw (a small metal hook/bracket screwed into the wall holding the cable), this photo is ALWAYS Step 3 (Cable Entry Outside). No exceptions. This hardware is only used on exterior walls.

DO NOT confuse Step 3 and Step 4:
  - Sky visible = outside (Step 3)
  - Corrugated roof = outside (Step 3)
  - J-hook/pigtail screw on wall = ALWAYS outside (Step 3)
  - Interior roof rafters/shutters at top = inside (Step 4)
  - White ceiling trim or painted interior wall = inside (Step 4)
  - Silicone blob at hole in smooth interior wall = inside (Step 4)

--- STEP 2: Cable from Pole ---
A CORRECT Step 2 photo MUST show ALL of the following:
  ✅ A utility pole is clearly visible in the frame
  ✅ A cable/fiber span is visible crossing through the air (typically against the sky) from the pole towards the building

A Step 2 photo is INCORRECT (mark as FAIL, reason below) if ANY of the following are true:
  ❌ No utility pole is visible in the frame → reason: "The pole is not in view"
  ❌ Only the cable span is visible without a pole in frame → reason: "The pole is not in view"
  ❌ Only a building rooftop or wall is shown with no pole or cable span → reason: "The pole is not in view"

IMPORTANT: The presence of the pole in the frame is mandatory. A cable-only shot with no visible pole does not confirm the installation source and must be marked incorrect.

--- STEP 5: Wall for Installation ---
A CORRECT Step 5 photo MUST show ALL of the following:
  ✅ A wooden board/plank is mounted on the wall (the backing board for the ONT)
  ✅ A wall mount bracket is physically attached to the wooden board. Acceptable bracket types:
     • White metal rectangular mounting rail/bracket with holes (standard ONT mount)
     • Circular or D-ring style bracket screwed into the wooden board
  ✅ The wooden board + mount bracket combination must be clearly visible together

A Step 5 photo is INCORRECT (mark as FAIL, reason below) if ANY of the following are true:
  ❌ No wooden board with a mount bracket is visible → reason: "No wall mount in view"
  ❌ A wooden board or pole is present but has NO mount bracket attached → reason: "No wall mount in view"
  ❌ Just a bare wall surface with no wooden board or bracket → reason: "No wall mount in view"
  ❌ A plain, empty wall — regardless of condition (clean, worn, peeling) — with no mount hardware → reason: "No wall mount in view"

The wooden board with the attached mount bracket is the ONLY proof that the wall has been prepared for ONT installation. A bare wall, even with a wooden pole or plank, is not sufficient.

--- STEP 1: House / Property Photo ---
A CORRECT Step 1 photo MUST show ALL of the following:
  ✅ The full property (or near-full property) is visible in the frame
  ✅ At least two sides/corners of the building are visible, OR the front face with roof and both edges in frame
  ✅ The roof and at least one wall with a door or window are visible
  ✅ The structure is clearly identifiable as a complete building/home/property

A Step 1 photo is INCORRECT (mark as FAIL, reason below) if ANY of the following are true:
  ❌ Only one wall/side of the property is visible (shot too close or too side-on) → reason: "Full property not in view"
  ❌ The roof or edges of the building are cut off and the full structure cannot be seen → reason: "Full property not in view"
  ❌ The photo is a close-up of a wall, door, or window without showing the full property → reason: "Full property not in view"

--- STEP 7: Power Meter Reading ---
A CORRECT Step 7 photo MUST show:
  ✅ A handheld optical power meter device with its display clearly visible
  ✅ The dBm reading is legible — numbers can be clearly read on the screen

A Step 7 photo is INCORRECT if:
  ❌ The display is blurry, dark, or the numbers cannot be clearly read → reason: "Power meter reading not clearly visible"
  ❌ No power meter device is shown → reason: "Power meter reading not clearly visible"

DUPLICATE RULE — If two power meter photos are submitted:
  Keep the photo with the CLEAREST, most legible dBm number on screen.
  Reject the less clear one as a duplicate → reason: "Duplicate — clearer power meter photo already present"

--- STEP 10: Signature ---
A CORRECT Step 10 photo MUST show:
  ✅ A visible customer signature on a form, paper, or tablet
  ✅ The signature is recognisable as handwriting/a signature (not a blank or near-blank form)

A Step 10 photo is INCORRECT if:
  ❌ No signature is visible → reason: "No signature visible"
  ❌ The form is blank or the signature area is empty → reason: "No signature visible"

DUPLICATE RULE — If two signature photos are submitted:
  Keep the photo that most clearly looks like a completed signature on a form.
  Reject the one that looks less like a signature (e.g. blurry, partial, or unclear) → reason: "Duplicate — clearer signature photo already present"

--- STEP 12: Dome Joint Closed ---
A CORRECT Step 12 photo MUST show:
  ✅ The dome joint with its black rectangular lid SEALED/CLOSED on the circular housing
  ✅ Only the black exterior/back of the dome joint box is visible
  ✅ The interior of the box is NOT visible — it is completely sealed
  ✅ Yellow cables may be visible entering the bottom of the sealed unit — this is normal

A Step 12 photo is INCORRECT if:
  ❌ The interior of the dome joint is visible (white interior, green splices) → this is Step 11 (Open), not Step 12

--- STEP 11: Dome Joint Open ---
A CORRECT Step 11 photo MUST show:
  ✅ The dome joint lid is REMOVED or OPEN
  ✅ The WHITE interior of the dome joint box is clearly visible
  ✅ GREEN fiber splice connectors ("green flickers") are visible inside the box
  ✅ Internal components are visible: splice tray, black cable management clips, splitter blocks, cable routing

A Step 11 photo is INCORRECT if:
  ❌ The lid is closed and no interior is visible → this is Step 12 (Closed), not Step 11

DO NOT confuse Step 11 and Step 12:
  - Green fiber splices + white interior visible = OPEN = Step 11
  - Only black exterior/back visible, interior sealed = CLOSED = Step 12
  - The presence of green connectors inside is the single clearest indicator that the dome joint is open (Step 11)
  - If you can only see the black box with no internal components = always Step 12
`;
