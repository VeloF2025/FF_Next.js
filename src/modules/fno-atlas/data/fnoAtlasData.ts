export type FnoType = 'FTTH' | 'FTTB' | 'Metro Backhaul' | 'National Backhaul' | 'Wholesale Aggregator';
export type DataMethod = 'Official portal' | 'Public web page' | 'PDF/map extraction' | 'Aggregator API' | 'Manual verification';

export interface FnoNetwork {
  id: string;
  name: string;
  types: FnoType[];
  footprint: string;
  strongRegions: string[];
  projectFit: string[];
  backhaulNotes: string;
  website: string;
  coverageSource: string;
  dataMethod: DataMethod;
  confidence: 'High' | 'Medium' | 'Needs verification';
}

export interface ProjectArchetype {
  id: string;
  label: string;
  description: string;
  bestFitFnos: string[];
  backhaulPriority: string;
}

export interface ScrapingToolOption {
  name: string;
  fit: string;
  verdict: 'Recommended' | 'Use when needed' | 'Not primary';
  notes: string;
}

export const moduleName = 'FNO Atlas';

export const fnoNetworks: FnoNetwork[] = [
  {
    id: 'openserve',
    name: 'Openserve',
    types: ['FTTH', 'FTTB', 'National Backhaul'],
    footprint: 'National incumbent footprint with broad city and town coverage.',
    strongRegions: ['National', 'Gauteng', 'Western Cape', 'KwaZulu-Natal', 'Eastern Cape'],
    projectFit: ['brownfield suburbs', 'business parks', 'town expansion', 'lower-risk national reach'],
    backhaulNotes: 'Good default for wide-area feasibility and towns where alternative open-access FNOs are thin.',
    website: 'https://openserve.co.za/connect/home/fibre',
    coverageSource: 'https://openserve.co.za/connect/home/fibre',
    dataMethod: 'Official portal',
    confidence: 'High',
  },
  {
    id: 'vumatel',
    name: 'Vumatel',
    types: ['FTTH', 'FTTB'],
    footprint: 'Large residential open-access footprint, especially metros and dense suburbs.',
    strongRegions: ['Gauteng', 'Western Cape', 'KwaZulu-Natal'],
    projectFit: ['residential estates', 'dense suburbs', 'MDUs', 'premium FTTH demand'],
    backhaulNotes: 'Best matched to dense residential demand; verify upstream handoff per area.',
    website: 'https://vumatel.co.za/',
    coverageSource: 'https://vumatel.co.za/',
    dataMethod: 'Official portal',
    confidence: 'High',
  },
  { id: 'fibertime', name: 'Fibertime', types: ['FTTH'], footprint: 'Township and underserved-community fibre rollout focused on prepaid, affordable access; Nokia public material references 400,000 additional homes and a 2m-home target by 2028.', strongRegions: ['Gauteng', 'KwaZulu-Natal', 'townships', 'underserved communities'], projectFit: ['township FTTH', 'prepaid fibre', 'rural edge', 'low-LSM rollouts', 'underserved communities'], backhaulNotes: 'Critical low-LSM reference layer; validate feeder/backhaul economics and area status before route commitment.', website: 'https://fibertime.com/', coverageSource: 'https://www.nokia.com/newsroom/nokia-and-fibertime-accelerate-roll-out-of-fiber-broadband-access-to-underserved-townships-across-south-africa/', dataMethod: 'Public web page', confidence: 'Medium' },  { id: 'net99', name: 'Net Nine Nine', types: ['FTTH'], footprint: 'Affordable prepaid/home fibre operator targeting township and underserved communities; public funding reports reference large-scale township FTTH expansion.', strongRegions: ['Gauteng', 'KwaZulu-Natal', 'townships', 'underserved communities'], projectFit: ['township FTTH', 'prepaid fibre', 'low-LSM rollouts', 'affordable home fibre'], backhaulNotes: 'Add to every low-income feasibility scan; confirm exact network build areas and wholesale handoff model.', website: 'https://netninenine.co.za/', coverageSource: 'https://www.rmb.co.za/news/rmb-partners-with-net-99-to-expand-affordable-fibre-access-in-underserved-communities', dataMethod: 'Public web page', confidence: 'Medium' },  {
    id: 'dfa',
    name: 'DFA',
    types: ['Metro Backhaul', 'National Backhaul'],
    footprint: 'Open-access dark fibre backbone; public material claims 20,000+ km and metro coverage in key SA cities.',
    strongRegions: ['Gauteng', 'Western Cape', 'KwaZulu-Natal', 'major metros'],
    projectFit: ['metro backhaul', 'tower backhaul', 'enterprise parks', 'core route planning'],
    backhaulNotes: 'Primary layer to check when deciding whether a project has carrier-grade metro backhaul nearby.',
    website: 'https://dfafrica.co.za/',
    coverageSource: 'https://dfafrica.co.za/',
    dataMethod: 'Public web page',
    confidence: 'Medium',
  },
  {
    id: 'liquid',
    name: 'Liquid Intelligent Technologies',
    types: ['FTTB', 'Metro Backhaul', 'National Backhaul'],
    footprint: 'Pan-African and South African business fibre/backbone network; public material cites 116,000+ km across Africa.',
    strongRegions: ['National', 'Gauteng', 'Western Cape', 'KwaZulu-Natal', 'cross-border corridors'],
    projectFit: ['enterprise fibre', 'carrier services', 'cross-border capacity', 'national aggregation'],
    backhaulNotes: 'Strategic for business fibre and NLD/cross-border paths; use coverage portal plus account-manager validation.',
    website: 'https://za.liquid.tech/about-us/our-network/',
    coverageSource: 'https://coverage.za.liquid.tech/coverage',
    dataMethod: 'Official portal',
    confidence: 'High',
  },
  {
    id: 'frogfoot',
    name: 'Frogfoot',
    types: ['FTTH', 'FTTB'],
    footprint: 'Open-access FNO with strong Western Cape, Pretoria and estate/suburb footprint.',
    strongRegions: ['Western Cape', 'Gauteng', 'Eastern Cape', 'Garden Route'],
    projectFit: ['estates', 'suburbs', 'small-town FTTH', 'Cape-focused residential'],
    backhaulNotes: 'Useful where its coverage map shows live or WIP polygons; check status layers before committing.',
    website: 'https://www.frogfoot.co.za/coverage/',
    coverageSource: 'https://maps.frogfoot.net/beta',
    dataMethod: 'Official portal',
    confidence: 'High',
  },
  {
    id: 'metrofibre',
    name: 'MetroFibre',
    types: ['FTTH', 'FTTB'],
    footprint: 'Open-access FTTH/FTTB operator with metro and selected regional rollouts.',
    strongRegions: ['Gauteng', 'KwaZulu-Natal', 'Eastern Cape', 'selected towns'],
    projectFit: ['suburban FTTH', 'business fibre', 'regional town expansion'],
    backhaulNotes: 'Good candidate for new suburbs and business parks; source may be API-backed via ISP portals.',
    website: 'https://metrofibre.co.za/',
    coverageSource: 'https://metrofibre.co.za/',
    dataMethod: 'Official portal',
    confidence: 'Medium',
  },
  {
    id: 'octotel',
    name: 'Octotel',
    types: ['FTTH', 'FTTB'],
    footprint: 'Western Cape-focused open-access fibre network.',
    strongRegions: ['Cape Town', 'Western Cape'],
    projectFit: ['Cape suburbs', 'MDUs', 'Western Cape residential/business'],
    backhaulNotes: 'Strong Cape layer; outside Western Cape treat as low fit unless partner source confirms.',
    website: 'https://octotel.co.za/',
    coverageSource: 'https://octotel.co.za/coverage-map/',
    dataMethod: 'Official portal',
    confidence: 'High',
  },
  {
    id: 'herotel',
    name: 'Herotel',
    types: ['FTTH', 'FTTB'],
    footprint: 'Fibre plus fixed-wireless footprint across smaller towns and communities.',
    strongRegions: ['Western Cape', 'Northern Cape', 'Free State', 'North West', 'smaller towns'],
    projectFit: ['secondary towns', 'rural edge', 'hybrid fibre/wireless areas'],
    backhaulNotes: 'Useful where traditional metro FNOs are absent; validate fibre vs wireless availability.',
    website: 'https://herotel.com/',
    coverageSource: 'https://herotelbusiness.com/check-coverage/',
    dataMethod: 'Official portal',
    confidence: 'Medium',
  },
  {
    id: 'evotel',
    name: 'Evotel',
    types: ['FTTH'],
    footprint: 'Selected residential areas across South Africa.',
    strongRegions: ['selected suburbs', 'selected towns'],
    projectFit: ['residential infill', 'suburb-specific FTTH'],
    backhaulNotes: 'Candidate for suburb-level opportunities only after address/suburb validation.',
    website: 'https://evotel.co.za/',
    coverageSource: 'https://evotel.co.za/',
    dataMethod: 'Official portal',
    confidence: 'Medium',
  },
  {
    id: 'link-africa',
    name: 'Link Africa',
    types: ['FTTH', 'Metro Backhaul'],
    footprint: 'Open-access network operator with metro and municipal route assets.',
    strongRegions: ['KwaZulu-Natal', 'Gauteng', 'Western Cape'],
    projectFit: ['municipal routes', 'metro backhaul', 'selected FTTH overlays'],
    backhaulNotes: 'Important for duct/wayleave-style metro route feasibility where available.',
    website: 'https://linkafrica.co.za/',
    coverageSource: 'https://linkafrica.co.za/',
    dataMethod: 'Manual verification',
    confidence: 'Needs verification',
  },
  {
    id: 'zoom-fibre',
    name: 'Zoom Fibre',
    types: ['FTTH'],
    footprint: 'Selected open-access residential footprint.',
    strongRegions: ['selected suburbs', 'estates'],
    projectFit: ['residential estates', 'new developments'],
    backhaulNotes: 'Treat as suburb/project-specific until coverage source is validated.',
    website: 'https://zoomfibre.co.za/',
    coverageSource: 'https://zoomfibre.co.za/',
    dataMethod: 'Official portal',
    confidence: 'Needs verification',
  },
  {
    id: 'lightstruck',
    name: 'Lightstruck',
    types: ['FTTH', 'FTTB'],
    footprint: 'Selected Cape and estate/community footprint.',
    strongRegions: ['Western Cape', 'selected estates'],
    projectFit: ['estates', 'Cape-focused residential', 'premium communities'],
    backhaulNotes: 'Good niche layer; needs polygon/source confirmation per project.',
    website: 'https://www.lightstruck.co.za/',
    coverageSource: 'https://www.lightstruck.co.za/',
    dataMethod: 'Official portal',
    confidence: 'Needs verification',
  },
  {
    id: 'broadband-infraco',
    name: 'Broadband Infraco',
    types: ['National Backhaul'],
    footprint: 'National wholesale backbone and strategic long-distance connectivity.',
    strongRegions: ['National', 'long-distance corridors'],
    projectFit: ['NLD backhaul', 'rural aggregation', 'public-sector connectivity'],
    backhaulNotes: 'Backbone layer, not normal FTTH. Useful for remote town aggregation questions.',
    website: 'https://www.infraco.co.za/',
    coverageSource: 'https://www.infraco.co.za/',
    dataMethod: 'Manual verification',
    confidence: 'Needs verification',
  },
  {
    id: 'seacom',
    name: 'SEACOM',
    types: ['FTTB', 'National Backhaul'],
    footprint: 'Carrier, IP transit, subsea and business connectivity layer.',
    strongRegions: ['National', 'coastal landing corridors', 'major metros'],
    projectFit: ['enterprise', 'international capacity', 'carrier-grade transit'],
    backhaulNotes: 'Use as upstream/transit/backbone option rather than residential FNO fit.',
    website: 'https://seacom.com/',
    coverageSource: 'https://seacom.com/',
    dataMethod: 'Public web page',
    confidence: 'Medium',
  },
  {
    id: 'letaba',
    name: 'Letaba Networks',
    types: ['FTTH'],
    footprint: 'Wireless-first regional ISP across Limpopo and Mpumalanga (Vhembe, Mopani and Ehlanzeni districts, Musina to Lydenburg), plus TruFibre/SkyFibre. Publishes no coverage map — presence points are point-probed from their public coverage-check API.',
    strongRegions: ['Limpopo', 'Mpumalanga', 'Vhembe', 'Mopani', 'Ehlanzeni'],
    projectFit: ['regional wireless', 'rural edge', 'secondary towns', 'Limpopo/Mpumalanga coverage'],
    backhaulNotes: 'Wireless-first footprint useful where metro FNOs are absent in Limpopo/Mpumalanga. Coverage is point-probed, not a published layer.',
    website: 'https://letaba.net/',
    coverageSource: 'https://letaba.net/',
    dataMethod: 'Official portal',
    confidence: 'Medium',
  },
];

export const projectArchetypes: ProjectArchetype[] = [
  {
    id: 'dense-residential',
    label: 'Dense residential / MDU',
    description: 'High take-up suburbs, estates and apartment blocks where speed to activate and open-access ISP choice matter.',
    bestFitFnos: ['vumatel', 'frogfoot', 'octotel', 'metrofibre', 'openserve'],
    backhaulPriority: 'Check nearest DFA/Liquid metro POP before civils scope is priced.',
  },
  {
    id: 'business-park',
    label: 'Business park / SME fibre',
    description: 'Commercial precincts needing SLA, static IP, managed CPE and carrier handoff options.',
    bestFitFnos: ['liquid', 'dfa', 'metrofibre', 'openserve', 'seacom'],
    backhaulPriority: 'Prioritise Liquid/DFA/SEACOM availability and route diversity.',
  },
  {
    id: 'secondary-town',
    label: 'Secondary town rollout',
    description: 'Towns outside the obvious metro footprint where incumbents or hybrid operators may have better economics.',
    bestFitFnos: ['openserve', 'herotel', 'frogfoot', 'metrofibre', 'broadband-infraco'],
    backhaulPriority: 'Validate NLD backhaul first; project economics fail without affordable upstream.',
  },
  { id: 'rural-low-lsm', label: 'Rural / low-LSM rollout', description: 'Township, peri-urban and rural-edge builds where prepaid pricing, low ARPU, uptake density and affordable backhaul decide viability.', bestFitFnos: ['fibertime', 'net99', 'openserve', 'herotel', 'broadband-infraco'], backhaulPriority: 'Model feeder distance, power, pole/duct reuse, prepaid demand and POP/NLD cost before committing civils.' },  {
    id: 'metro-backhaul',
    label: 'Metro backhaul / route planning',
    description: 'Route feasibility for towers, aggregation nodes, POPs and long-haul interconnects.',
    bestFitFnos: ['dfa', 'liquid', 'link-africa', 'seacom', 'broadband-infraco'],
    backhaulPriority: 'Map ducts, POPs, cross-connects and diverse paths before FTTH overlays.',
  },
];

export const scrapingTools: ScrapingToolOption[] = [
  {
    name: 'Crawlee + Playwright',
    verdict: 'Recommended',
    fit: 'TypeScript-native scraping for JS-heavy FNO coverage portals and source normalisation jobs.',
    notes: 'Best match for FibreFlow because the app is TypeScript and most coverage maps need browser automation, network interception and repeatable jobs.',
  },
  {
    name: 'Playwright only',
    verdict: 'Use when needed',
    fit: 'One-off deep extraction from a specific dynamic coverage map.',
    notes: 'Ideal for reverse-engineering map API calls and capturing screenshots, but Crawlee gives better job orchestration.',
  },
  {
    name: 'Scrapy',
    verdict: 'Not primary',
    fit: 'Large static HTML crawling and structured pages.',
    notes: 'Mature, but Python stack mismatch and less useful for dynamic address/map portals without browser integration.',
  },
  {
    name: 'Thunderbit / no-code',
    verdict: 'Use when needed',
    fit: 'Fast manual extraction from tables, lists and marketing pages.',
    notes: 'Good operator tool, not the production ingestion engine for FibreFlow because we need auditable repeatable jobs and source diffs.',
  },
  {
    name: 'Aggregator coverage API',
    verdict: 'Use when needed',
    fit: 'Address-level qualification across many FNOs.',
    notes: 'Potentially best for feasibility checks if commercial terms work; still keep official-source evidence for strategic route/backhaul planning.',
  },
];
