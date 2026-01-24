/**
 * VLM Photo Evaluation API
 * Calls the FiberTime-aligned VLM on velo-server for DR photo verification
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { withAuth } from '@/lib/auth';
const VLM_URL = process.env.VLM_API_URL || 'http://100.96.203.105:8100';
const VLM_MODEL = process.env.VLM_MODEL || 'dr-verifier';

// Step prompts based on FiberTime verification manual
const STEP_PROMPTS: Record<number, string> = {
    1: `Analyze this DR installation photo for Step 1: House Photo + Housing Type Detection.
Look for:
- Building exterior (house, apartment, or commercial property)
- Housing type: Formal (brick/plastered walls), Informal (corrugated iron/zinc), or RDP (small government brick)

Return JSON with: { 
  "accepted": boolean, 
  "confidence": number, 
  "housing_classification": { "type": "formal"|"informal"|"rdp", "confidence": number, "indicators_found": string[] },
  "details": string 
}`,

    2: `Analyze this DR installation photo for Step 2: Cable from Pole.
Look for 4 elements:
1. Utility pole (wooden/concrete)
2. Dome joint (fiber splice enclosure)
3. Cable run (thin 2-4mm fiber drop cable)
4. Connection point (hook/bracket where cable attaches to house)

Return JSON with: { 
  "accepted": boolean, 
  "elements_found": ["pole", "dome_joint", "cable_run", "connection_point"],
  "confidence": number, 
  "details": string 
}`,

    3: `Analyze this DR installation photo for Step 3: Cable Entry Outside.
Validate entry method based on housing type:
- Formal: Roof overhang entry with 12mm duct
- Informal: Electrical gland entry with silicone seal
- RDP: Fascia board entry with duct

Return JSON with: { 
  "accepted": boolean, 
  "entry_validation": { "entry_method_detected": string, "matches_housing_type": boolean, "fibertime_compliant": boolean },
  "confidence": number, 
  "details": string 
}`,

    4: `Analyze this DR installation photo for Step 4: Cable Entry Inside.
Look for:
- Cable entry point from inside
- Cable routing (should follow natural contours)
- ONT location area

Return JSON with: { 
  "accepted": boolean, 
  "elements_found": string[],
  "fibertime_compliance": { "cable_routing_unintrusive": boolean },
  "confidence": number, 
  "details": string 
}`,

    5: `Analyze this DR installation photo for Step 5: Wall for Installation.
CRITICAL: Look for Fibertime-required wooden board (280mm x 120mm)
- Wooden board mounted on wall
- ONT bracket on board
- Wall plug/power outlet nearby

Return JSON with: { 
  "accepted": boolean, 
  "elements_found": ["wooden_board", "mounting_bracket", "wall_plug"],
  "fibertime_compliance": { "wooden_board_visible": boolean, "board_appears_level": boolean },
  "confidence": number, 
  "details": string 
}`,

    6: `Analyze this DR installation photo for Step 6: ONT Back After Install.
Look for:
- Nokia ONT device (white rectangular box)
- Green SC/APC fiber connector at back
- Fiber loop around fiber management (at least 1 loop)

Return JSON with: { 
  "accepted": boolean, 
  "fibertime_compliance": { "fiber_loop_visible": boolean, "sc_apc_connector_visible": boolean },
  "confidence": number, 
  "details": string 
}`,

    7: `Analyze this DR installation photo for Step 7: Power Meter Reading.
Look for:
- Power meter display with dBm reading
- Reading should be -10 to -24 dBm (acceptable range)
- -25 to -28 dBm is warning, -29 or worse is fail

Return JSON with: { 
  "accepted": boolean, 
  "power_reading_dbm": number or null,
  "power_status": "excellent"|"good"|"warning"|"critical",
  "confidence": number, 
  "details": string 
}`,

    8: `Analyze this DR installation photo for Step 8: ONT Barcode/Serial.
Look for:
- Barcode label on back/side of ONT (NOT front panel)
- Serial number starting with "ALCL" (Nokia format)
- Extract the full serial number if readable

Return JSON with: { 
  "accepted": boolean, 
  "is_barcode_label": boolean,
  "is_front_panel": boolean,
  "serial_number": string or null,
  "serial_format_valid": boolean,
  "confidence": number, 
  "details": string 
}`,

    9: `Analyze this DR installation photo for Step 9: UPS/Gizzu Serial + Voltage Check.
CRITICAL: Check voltage selector (MUST be 12V, NOT 9V)
- UPS/Gizzu device visible
- Serial number on label
- Voltage selector position

Return JSON with: { 
  "accepted": boolean, 
  "ups_serial": string or null,
  "fibertime_compliance": { "voltage_selector_visible": boolean, "voltage_setting": "12V"|"9V"|"unknown", "voltage_correct": boolean },
  "confidence": number, 
  "details": string 
}`,

    10: `Analyze this DR installation photo for Step 10: Final Installation.
Check complete installation:
- Wooden board (280mm x 120mm)
- ONT mounted level
- Antennas UPRIGHT (both vertical)
- Gizzu/UPS on top of bracket
- Cable management acceptable
- Fibertime sticker centered on ONT

Return JSON with: { 
  "accepted": boolean, 
  "fibertime_compliance": { 
    "wooden_board_visible": boolean, "ont_level": boolean, "antennas_upright": boolean, 
    "gizzu_mounted": boolean, "cable_management_acceptable": boolean, "fibertime_sticker_visible": boolean 
  },
  "confidence": number, 
  "details": string 
}`,

    11: `Analyze this DR installation photo for Step 11: Green Lights.
Look for:
- ONT front panel LEDs (POWER, PON, LAN, 2.4GHz, 5GHz, INTERNET)
- Count illuminated lights (minimum 4 for pass)
- DR drop label (yellow sticker with DRxxxxx)
- Antennas upright

Return JSON with: { 
  "accepted": boolean, 
  "lights_count": number,
  "lights_identified": string[],
  "dr_number_on_label": string or null,
  "fibertime_compliance": { "antennas_upright": boolean, "internet_light_on": boolean },
  "confidence": number, 
  "details": string 
}`,
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { step, imageBase64, housingType, drNumber } = req.body;

    if (!step || !imageBase64) {
        return res.status(400).json({ error: 'Missing required fields: step, imageBase64' });
    }

    const stepNumber = parseInt(step, 10);
    if (stepNumber < 1 || stepNumber > 11) {
        return res.status(400).json({ error: 'Invalid step number (1-11)' });
    }

    // Get step-specific prompt
    let prompt = STEP_PROMPTS[stepNumber];

    // Add housing context for step 3
    if (stepNumber === 3 && housingType) {
        prompt = `Housing Type from Step 1: ${housingType}\n\n${prompt}`;
    }

    // Add DR context
    if (drNumber) {
        prompt = `DR Number: ${drNumber}\n\n${prompt}`;
    }

    try {
        const response = await fetch(`${VLM_URL}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: VLM_MODEL,
                messages: [
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: prompt },
                            {
                                type: 'image_url',
                                image_url: {
                                    url: imageBase64.startsWith('data:')
                                        ? imageBase64
                                        : `data:image/jpeg;base64,${imageBase64}`
                                }
                            },
                        ],
                    },
                ],
                max_tokens: 1024,
                temperature: 0.1,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('VLM API error:', errorText);
            return res.status(response.status).json({
                error: 'VLM API error',
                details: errorText
            });
        }

        const vlmResponse = await response.json();
        const content = vlmResponse.choices?.[0]?.message?.content || '';

        // Try to parse JSON from response
        let evaluation;
        try {
            // Extract JSON from response (may be wrapped in markdown code blocks)
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                evaluation = JSON.parse(jsonMatch[0]);
            } else {
                evaluation = {
                    raw_response: content,
                    accepted: null,
                    details: 'Could not parse structured response'
                };
            }
        } catch {
            evaluation = {
                raw_response: content,
                accepted: null,
                details: 'Failed to parse VLM response as JSON'
            };
        }

        return res.status(200).json({
            step: stepNumber,
            dr_number: drNumber,
            housing_type: housingType,
            evaluation,
            model: VLM_MODEL,
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        console.error('VLM evaluation error:', error);
        return res.status(502).json({
            error: 'Failed to connect to VLM service',
            details: error instanceof Error ? error.message : 'Unknown error',
        });
    }
}

export const config = {
    api: {
        bodyParser: {
            sizeLimit: '20mb', // Large images
        },
    },
}

export default withAuth(handler);;
