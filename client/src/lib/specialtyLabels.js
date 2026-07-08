// Transcribed from "Panel Stock Headers.txt" (repo root). ZIP/CITIES/TOTAL
// are not specialties and are intentionally omitted.
export const SPECIALTY_LABELS = {
  ACA_TOT: 'Acupuncture Specialist',
  DCH_TOT: 'Chiropractic',
  DEN_TOT: 'Dentistry',
  MAA_TOT: 'Anesthesiology',
  MAI_TOT: 'Allergy and Immunology',
  MDE_TOT: 'Dermatology',
  MEM_TOT: 'Emergency Medicine',
  MFP_TOT: 'Family Practice',
  MHA_TOT: 'Pathology',
  MHH_TOT: 'Hand (Hand Surgery)',
  MME_TOT: 'Internal Medicine, Endocrinology',
  MMG_TOT: 'Internal Medicine, Gastroenterology',
  MMH_TOT: 'Internal Medicine, Hematology',
  MMI_TOT: 'Internal Medicine, Infectious Disease',
  MMM_TOT: 'Internal Medicine',
  MMN_TOT: 'Internal Medicine, Nephrology',
  MMO_TOT: 'Internal Medicine, Medical Oncology',
  MMP_TOT: 'Internal Medicine, Pulmonary Disease',
  MMR_TOT: 'Internal Medicine, Rheumatology',
  MMV_TOT: 'Internal Medicine, Cardiovascular Disease',
  MNB_TOT: 'Spine',
  MNS_TOT: 'Neurological Surgery (other than Spine)',
  MOG_TOT: 'Obstetrics and Gynecology',
  MOP_TOT: 'Ophthalmology',
  MOQ_TOT: 'Medicine Otherwise Qualified',
  MOS_TOT: 'Orthopaedic Surgery (other than Spine or Hand)',
  MPA_TOT: 'Pain Medicine',
  MPD_TOT: 'Psychiatry (other than Pain Medicine)',
  MPM_TOT: 'General Preventive Medicine',
  MPN_TOT: 'Neurology',
  MPO_TOT: 'Occupational Medicine',
  MPR_TOT: 'Physical Medicine and Rehabilitation',
  MPS_TOT: 'Plastic Surgery (other than Hand)',
  MSG_TOT: 'Surgery, General Vascular',
  MSY_TOT: 'Surgery (other than Spine or Hand)',
  MTO_TOT: 'Otolaryngology',
  MTS_TOT: 'Thoracic Surgery',
  MTT_TOT: 'Toxicology',
  MUU_TOT: 'Urology',
  OPT_TOT: 'Optometry',
  POD_TOT: 'Podiatry',
  PSY_TOT: 'Psychology'
};

// Falls back to the raw header (with a trailing "_TOT" stripped, since that
// suffix just marks "total" and isn't meaningful as a displayed name) if no
// translation exists (unknown/new codes).
export function getSpecialtyName(header) {
  return SPECIALTY_LABELS[header] || header.replace(/_TOT$/, '');
}
