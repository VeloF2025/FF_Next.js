"""
Document Classification and Field Extraction
PRD Reference: PRD-032 Section 5

Handles:
- Document type classification
- Field extraction based on document type
- SA-specific validation (ID, bank accounts, etc.)
"""

import re
import logging
from dataclasses import dataclass, field
from typing import Dict, Any, List, Optional, Tuple
from enum import Enum

logger = logging.getLogger(__name__)


class DocumentType(str, Enum):
    """Supported document types."""
    ID_DOCUMENT = "id_document"
    PASSPORT = "passport"
    DRIVERS_LICENSE = "drivers_license"
    BANK_DETAILS = "bank_details"
    BANK_CONFIRMATION = "bank_confirmation"
    TAX_DOCUMENT = "tax_document"
    CIPC_REGISTRATION = "cipc_registration"
    TAX_CLEARANCE = "tax_clearance"
    BEE_CERTIFICATE = "bee_certificate"
    UNKNOWN = "unknown"


class EntityType(str, Enum):
    """Entity types for field mapping."""
    STAFF = "staff"
    CONTRACTOR = "contractor"


@dataclass
class ExtractedField:
    """A single extracted field."""
    field_name: str
    value: str
    confidence: float
    source: str
    validated: bool = False
    validation_message: Optional[str] = None


@dataclass
class ClassificationResult:
    """Document classification result."""
    document_type: DocumentType
    confidence: float
    matched_keywords: List[str] = field(default_factory=list)
    matched_patterns: List[str] = field(default_factory=list)


@dataclass
class ExtractionResult:
    """Complete extraction result."""
    classification: ClassificationResult
    extracted_fields: Dict[str, ExtractedField]
    entity_type: EntityType


# Document type detection keywords
DOCUMENT_KEYWORDS = {
    DocumentType.ID_DOCUMENT: [
        # === SA ID Documents Only ===
        # Primary identifiers (appear on both old and new IDs)
        "REPUBLIC OF SOUTH AFRICA",
        "IDENTITY",
        # Smart ID Card specific
        "NATIONAL IDENTITY CARD",
        "IDENTITY NUMBER",
        "SURNAME",
        "NATIONALITY",
        # Old ID Book specific
        "DEPARTMENT OF HOME AFFAIRS",
        "ID NUMBER",
        # Afrikaans variants (old ID books)
        "REPUBLIEK VAN SUID-AFRIKA",
        "IDENTITEIT",
        "IDENTITEITSNOMMER",
        # SA ID specific - 13-digit ID is unique to SA
        "SA IDENTITY",
        "SOUTH AFRICAN ID",
    ],
    DocumentType.PASSPORT: [
        # === International Passports ===
        # English - Primary (passport-specific keywords)
        "PASSPORT",
        "PASSPORT NO",
        "PASSEPORT",  # French
        "REISEPASS",  # German
        "PASAPORTE",  # Spanish
        "PASSAPORTE",  # Portuguese
        "PASSAPORTO",  # Italian
        "PASPOORT",   # Dutch
        # Passport-specific fields
        "DATE OF EXPIRY",
        "DATE OF ISSUE",
        "PLACE OF BIRTH",
        "ISSUING AUTHORITY",
        "AUTHORITY",
        "TRAVEL DOCUMENT",
        "MACHINE READABLE",
        "MRZ",
        "ICAO",
        "ISSUING STATE",
        # Multi-language passport fields
        "GIVEN NAMES",
        "DATE D'EXPIRATION",
        "DATE DE DÉLIVRANCE",
        "GÜLTIG BIS",
        "FECHA DE CADUCIDAD",
        "FECHA DE EXPEDICIÓN",
        # Type/Code fields common on passports
        "TYPE P",
        "TYPE/TYPE",
        "CODE/CODE",
    ],
    DocumentType.DRIVERS_LICENSE: [
        # === SA Driver's License ===
        # Primary identifiers
        "DRIVING LICENCE",
        "DRIVER'S LICENCE",
        "DRIVER'S LICENSE",
        "DRIVING LICENSE",
        "MOTOR VEHICLE LICENCE",
        # SA-specific terms
        "DEPARTMENT OF TRANSPORT",
        "TRAFFIC REGISTER",
        "NATIS",
        "NATIONAL TRAFFIC INFORMATION SYSTEM",
        # Vehicle codes (unique to license)
        "VEHICLE CODE",
        "VEHICLE CLASS",
        "CODE A",
        "CODE B",
        "CODE C",
        "CODE EB",
        "CODE EC",
        # Date fields specific to licenses
        "VALID FROM",
        "VALID TO",
        "FIRST ISSUE DATE",
        "FIRST ISSUED",
        # License-specific fields
        "LICENCE NUMBER",
        "LICENSE NUMBER",
        "RESTRICTIONS",
        "PROFESSIONAL DRIVING PERMIT",
        "PDP",
        "PrDP",
        # Afrikaans variants
        "BESTUURSLISENSIE",
        "MOTORVOERTUIG",
        "VERKEER",
    ],
    DocumentType.BANK_DETAILS: [
        "BANK",
        "CONFIRMATION",
        "ACCOUNT",
        "ACCOUNT HOLDER",
        "BRANCH",
        "ACCOUNT NUMBER",
        "BANKING DETAILS",
        "CONFIRMATION LETTER",
    ],
    DocumentType.TAX_DOCUMENT: [
        "IRP5",
        "SARS",
        "SOUTH AFRICAN REVENUE SERVICE",
        "TAX CERTIFICATE",
        "EMPLOYEES TAX CERTIFICATE",
        "TAX REFERENCE",
        "INCOME TAX",
    ],
    DocumentType.CIPC_REGISTRATION: [
        "CIPC",
        "COMPANIES AND INTELLECTUAL PROPERTY COMMISSION",
        "COMPANY REGISTRATION",
        "REGISTRATION CERTIFICATE",
        "CK NUMBER",
        "REGISTRATION NUMBER",
        "NOTICE OF REGISTRATION",
    ],
    DocumentType.TAX_CLEARANCE: [
        "TAX CLEARANCE",
        "SARS",
        "GOOD STANDING",
        "TAX COMPLIANCE STATUS",
        "TCS",
        "VALID UNTIL",
    ],
    DocumentType.BEE_CERTIFICATE: [
        "B-BBEE",
        "BEE",
        "BROAD-BASED BLACK ECONOMIC EMPOWERMENT",
        "VERIFICATION CERTIFICATE",
        "BEE LEVEL",
        "CONTRIBUTOR LEVEL",
        "EXEMPTED MICRO ENTERPRISE",
        "EME",
        "QSE",
    ],
}

# Document type patterns
DOCUMENT_PATTERNS = {
    DocumentType.ID_DOCUMENT: [
        r"\d{13}",  # SA ID number (13 digits) - unique to SA ID
        r"\d{1,2}\s*(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s*\d{4}",  # Date: "03 FEB 1978"
    ],
    DocumentType.PASSPORT: [
        r"[A-Z]{1,2}\d{6,9}",  # Generic passport number (1-2 letters + 6-9 digits)
        r"\d{9}",  # Numeric passport numbers (some countries)
        r"P[<>][A-Z]{3}",  # MRZ first line pattern (P<XXX or P>XXX)
        r"[A-Z0-9<]{30,44}",  # MRZ line pattern (30-44 alphanumeric chars with <)
        r"\d{1,2}\s*(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s*\d{4}",  # Date: "03 FEB 1978"
        r"(?:expir|valid)\s*(?:y|until|to)",  # Expiry indicators
    ],
    DocumentType.DRIVERS_LICENSE: [
        r"[A-Z]{2}\d{6,12}",  # SA license number format (2 letters + 6-12 digits)
        r"\d{8,12}",  # Numeric license numbers
        r"(?:code|CODE)\s*[A-Z]{1,3}[1-9]?",  # Vehicle codes (A, A1, B, C, C1, EB, EC)
        r"\d{1,2}\s*(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s*\d{4}",  # Date format
        r"\d{4}[-/]\d{2}[-/]\d{2}",  # Date: YYYY-MM-DD or YYYY/MM/DD
        r"(?:valid|geldig)\s*(?:from|to|tot|van)",  # Validity indicators
    ],
    DocumentType.BANK_DETAILS: [r"\d{9,12}", r"\d{6}"],  # Account and branch
    DocumentType.TAX_DOCUMENT: [r"\d{10}", r"IRP5"],  # Tax number
    DocumentType.CIPC_REGISTRATION: [r"\d{4}/\d{6}/\d{2}"],  # CIPC format
    DocumentType.TAX_CLEARANCE: [r"\d{10}", r"valid\s*(until|to)"],
    DocumentType.BEE_CERTIFICATE: [r"level\s*[1-8]", r"EME", r"QSE"],
}

# Field mappings by document type and entity
FIELD_MAPPINGS = {
    DocumentType.ID_DOCUMENT: {
        EntityType.STAFF: {
            # === SA ID Number variants ===
            "Identity Number": "idNumber",
            "Identity No": "idNumber",
            "ID Number": "idNumber",

            # === Passport Number (multiple languages) ===
            "Passport No": "passportNumber",
            "Passport Number": "passportNumber",
            "Passeport No": "passportNumber",
            "Reisepass Nr": "passportNumber",
            "Pasaporte No": "passportNumber",
            "Passaporto No": "passportNumber",
            "Paspoort Nr": "passportNumber",

            # === Name Fields (multiple languages) ===
            # English
            "Surname": "lastName",
            "Names": "firstName",
            "First Names": "firstName",
            "Given names": "firstName",
            "Given Names": "firstName",
            # French
            "Nom": "lastName",
            "Prénoms": "firstName",
            "Prenoms": "firstName",
            # German
            "Nachname": "lastName",
            "Vornamen": "firstName",
            # Spanish
            "Apellidos": "lastName",
            "Nombre": "firstName",
            # Portuguese
            "Apelidos": "lastName",
            "Nomes": "firstName",
            # Italian
            "Cognome": "lastName",
            # Dutch
            "Achternaam": "lastName",

            # === Date of Birth (multiple languages) ===
            "Date of Birth": "dateOfBirth",
            "Date of birth": "dateOfBirth",
            "Date de naissance": "dateOfBirth",
            "Geburtsdatum": "dateOfBirth",
            "Fecha de nacimiento": "dateOfBirth",
            "Data de nascimento": "dateOfBirth",
            "Data di nascita": "dateOfBirth",
            "Geboortedatum": "dateOfBirth",

            # === Place of Birth (multiple languages) ===
            "Place of birth": "placeOfBirth",
            "Place of Birth": "placeOfBirth",
            "Lieu de naissance": "placeOfBirth",
            "Geburtsort": "placeOfBirth",
            "Lugar de nacimiento": "placeOfBirth",
            "Local de nascimento": "placeOfBirth",
            "Luogo di nascita": "placeOfBirth",
            "Geboorteplaats": "placeOfBirth",

            # === Date of Issue (multiple languages) ===
            "Date of issue": "issuedDate",
            "Date of Issue": "issuedDate",
            "Date de délivrance": "issuedDate",
            "Ausstellungsdatum": "issuedDate",
            "Fecha de expedición": "issuedDate",

            # === Date of Expiry (multiple languages) ===
            "Date of expiry": "expiryDate",
            "Date of Expiry": "expiryDate",
            "Date d'expiration": "expiryDate",
            "Gültig bis": "expiryDate",
            "Fecha de caducidad": "expiryDate",

            # === Gender / Sex ===
            "Sex": "gender",
            "Gender": "gender",
            "Sexe": "gender",
            "Geschlecht": "gender",
            "Sexo": "gender",
            "Sesso": "gender",
            "Geslacht": "gender",

            # === Nationality / Citizenship ===
            "Nationality": "nationality",
            "Nationalité": "nationality",
            "Staatsangehörigkeit": "nationality",
            "Nacionalidad": "nationality",
            "Nacionalidade": "nationality",
            "Nazionalità": "nationality",
            "Nationaliteit": "nationality",
            "Country of Birth": "countryOfBirth",
            "Status": "citizenshipStatus",
        },
    },
    DocumentType.PASSPORT: {
        EntityType.STAFF: {
            # === Passport Number (multiple languages) ===
            "Passport No": "passportNumber",
            "Passport Number": "passportNumber",
            "Passeport No": "passportNumber",
            "No du passeport": "passportNumber",
            "Reisepass Nr": "passportNumber",
            "Pasaporte No": "passportNumber",
            "Passaporto No": "passportNumber",
            "Paspoort Nr": "passportNumber",

            # === Name Fields (multiple languages) ===
            "Surname": "lastName",
            "Names": "firstName",
            "First Names": "firstName",
            "Given names": "firstName",
            "Given Names": "firstName",
            "Nom": "lastName",
            "Prénoms": "firstName",
            "Prenoms": "firstName",
            "Nachname": "lastName",
            "Vornamen": "firstName",
            "Apellidos": "lastName",
            "Nombre": "firstName",
            "Apelidos": "lastName",
            "Nomes": "firstName",
            "Cognome": "lastName",
            "Achternaam": "lastName",

            # === Date of Birth (multiple languages) ===
            "Date of Birth": "dateOfBirth",
            "Date of birth": "dateOfBirth",
            "Date de naissance": "dateOfBirth",
            "Geburtsdatum": "dateOfBirth",
            "Fecha de nacimiento": "dateOfBirth",
            "Data de nascimento": "dateOfBirth",
            "Data di nascita": "dateOfBirth",
            "Geboortedatum": "dateOfBirth",

            # === Place of Birth ===
            "Place of birth": "placeOfBirth",
            "Place of Birth": "placeOfBirth",
            "Lieu de naissance": "placeOfBirth",
            "Geburtsort": "placeOfBirth",

            # === Date of Issue (multiple languages) ===
            "Date of issue": "issuedDate",
            "Date of Issue": "issuedDate",
            "Date de délivrance": "issuedDate",
            "Ausstellungsdatum": "issuedDate",
            "Fecha de expedición": "issuedDate",

            # === Date of Expiry (multiple languages) ===
            "Date of expiry": "expiryDate",
            "Date of Expiry": "expiryDate",
            "Date d'expiration": "expiryDate",
            "Gültig bis": "expiryDate",
            "Fecha de caducidad": "expiryDate",
            "Valid until": "expiryDate",

            # === Nationality / Citizenship ===
            "Nationality": "nationality",
            "Nationalité": "nationality",
            "Staatsangehörigkeit": "nationality",
            "Nacionalidad": "nationality",
            "Nacionalidade": "nationality",

            # === Issuing Authority / Country ===
            "Authority": "passportCountry",
            "Issuing Authority": "passportCountry",
            "Autorité": "passportCountry",
            "Issuing State": "passportCountry",
            "Country code": "passportCountry",
            "Code": "passportCountry",

            # === Gender / Sex ===
            "Sex": "gender",
            "Gender": "gender",
            "Sexe": "gender",
        },
    },
    DocumentType.DRIVERS_LICENSE: {
        EntityType.STAFF: {
            # === License Number ===
            "Licence Number": "licenseNumber",
            "License Number": "licenseNumber",
            "Licence No": "licenseNumber",
            "License No": "licenseNumber",
            "DL Number": "licenseNumber",
            "Driving Licence No": "licenseNumber",
            "Lisensienommer": "licenseNumber",  # Afrikaans

            # === Name Fields ===
            "Surname": "lastName",
            "Names": "firstName",
            "First Names": "firstName",
            "Full Name": "fullName",
            "Van": "lastName",  # Afrikaans
            "Naam": "firstName",  # Afrikaans

            # === ID Number (often on license) ===
            "Identity Number": "idNumber",
            "ID Number": "idNumber",
            "ID No": "idNumber",

            # === Date Fields ===
            "Date of Birth": "dateOfBirth",
            "Birth Date": "dateOfBirth",
            "Geboortedatum": "dateOfBirth",  # Afrikaans

            "Valid From": "issuedDate",
            "First Issue Date": "firstIssuedDate",
            "First Issued": "firstIssuedDate",
            "Eerste Uitgawe": "firstIssuedDate",  # Afrikaans

            "Valid To": "expiryDate",
            "Valid Until": "expiryDate",
            "Expiry Date": "expiryDate",
            "Expires": "expiryDate",
            "Geldig Tot": "expiryDate",  # Afrikaans

            # === Vehicle Codes ===
            "Vehicle Code": "vehicleCode",
            "Vehicle Codes": "vehicleCode",
            "Code": "vehicleCode",
            "Codes": "vehicleCode",
            "Vehicle Class": "vehicleCode",
            "Voertuigkode": "vehicleCode",  # Afrikaans

            # === Restrictions ===
            "Restrictions": "restrictions",
            "Restriction": "restrictions",
            "Beperkings": "restrictions",  # Afrikaans

            # === Professional Driving Permit ===
            "PrDP": "prdpType",
            "PDP": "prdpType",
            "Professional Driving Permit": "prdpType",

            # === Issuing Authority ===
            "Issuing Authority": "issuingAuthority",
            "Traffic Department": "issuingAuthority",
            "Issue Centre": "issuingAuthority",
        },
    },
    DocumentType.BANK_DETAILS: {
        EntityType.STAFF: {
            "Bank Name": "bankName",
            "Bank": "bankName",
            "Account Number": "bankAccountNumber",
            "Branch Code": "bankBranchCode",
            "Branch": "bankBranchCode",
            "Account Type": "bankAccountType",
        },
        EntityType.CONTRACTOR: {
            "Bank Name": "bankName",
            "Bank": "bankName",
            "Account Number": "accountNumber",
            "Branch Code": "branchCode",
            "Branch": "branchCode",
        },
    },
    DocumentType.TAX_DOCUMENT: {
        EntityType.STAFF: {
            "Tax Reference": "taxNumber",
            "Tax Number": "taxNumber",
            "Income Tax Reference": "taxNumber",
        },
    },
    DocumentType.CIPC_REGISTRATION: {
        EntityType.CONTRACTOR: {
            "Company Name": "companyName",
            "Name of Company": "companyName",
            "Registration Number": "registrationNumber",
            "CK Number": "registrationNumber",
            "Trading Name": "tradingName",
        },
    },
    DocumentType.TAX_CLEARANCE: {
        EntityType.CONTRACTOR: {
            "Tax Reference": "taxNumber",
            "Tax Number": "taxNumber",
            "Valid Until": "taxClearanceExpiry",
            "Expiry Date": "taxClearanceExpiry",
        },
    },
    DocumentType.BEE_CERTIFICATE: {
        EntityType.CONTRACTOR: {
            "BEE Level": "beeLevel",
            "Level": "beeLevel",
            "Contributor Level": "beeLevel",
            "Valid Until": "beeCertificateExpiry",
            "Expiry Date": "beeCertificateExpiry",
        },
    },
}

# SA Bank codes lookup
SA_BANK_CODES = {
    "250655": "ABSA Bank",
    "051001": "Standard Bank",
    "198765": "Standard Bank",
    "001255": "First National Bank (FNB)",
    "250355": "First National Bank (FNB)",
    "470010": "Capitec Bank",
    "462005": "Nedbank",
    "580105": "Investec Bank",
    "632005": "African Bank",
    "431010": "Bidvest Bank",
    "679000": "TymeBank",
    "678910": "Bank Zero",
    "430000": "Discovery Bank",
}


def classify_document(text: str) -> ClassificationResult:
    """
    Classify document type based on text content.

    Args:
        text: OCR extracted text

    Returns:
        ClassificationResult with document type and confidence
    """
    upper_text = text.upper()
    best_match = None
    best_score = 0.0
    best_keywords = []
    best_patterns = []

    for doc_type, keywords in DOCUMENT_KEYWORDS.items():
        # Count keyword matches
        matched_kw = [kw for kw in keywords if kw.upper() in upper_text]

        # For large keyword sets, use absolute count-based scoring
        # This prevents dilution when many keywords are defined
        if len(keywords) > 20:
            # ID documents: need at least 2 matches, score based on count
            keyword_score = min(len(matched_kw) / 5.0, 1.0)  # 5+ matches = 100%
        else:
            keyword_score = len(matched_kw) / len(keywords) if keywords else 0

        # Count pattern matches
        patterns = DOCUMENT_PATTERNS.get(doc_type, [])
        matched_pt = []
        for pattern in patterns:
            if re.search(pattern, text, re.IGNORECASE):
                matched_pt.append(pattern)
        pattern_score = len(matched_pt) / len(patterns) if patterns else 0

        # For non-ID documents, require at least 1 keyword match for patterns to count
        # This prevents bank_details from matching on numeric patterns alone
        if doc_type != DocumentType.ID_DOCUMENT and len(matched_kw) == 0:
            pattern_score = 0  # Don't count patterns without keyword evidence

        # Combined score (keywords weighted more)
        total_score = keyword_score * 0.6 + pattern_score * 0.4

        # Boost confidence for strong evidence (many keywords AND patterns matched)
        # ID documents with 5+ keywords and 2+ patterns are very likely correct
        if len(matched_kw) >= 5 and len(matched_pt) >= 2:
            total_score = max(total_score, 0.90)  # Floor at 90%
        elif len(matched_kw) >= 3 and len(matched_pt) >= 1:
            total_score = max(total_score, 0.85)  # Floor at 85%

        if total_score > best_score:
            best_score = total_score
            best_match = doc_type
            best_keywords = matched_kw
            best_patterns = matched_pt

    if best_match and best_score > 0.1:
        return ClassificationResult(
            document_type=best_match,
            confidence=best_score,
            matched_keywords=best_keywords,
            matched_patterns=best_patterns,
        )

    return ClassificationResult(
        document_type=DocumentType.UNKNOWN,
        confidence=0.0,
    )


def extract_fields(
    text: str,
    document_type: DocumentType,
    entity_type: EntityType
) -> Dict[str, ExtractedField]:
    """
    Extract fields from text based on document type.

    Args:
        text: OCR extracted text
        document_type: Classified document type
        entity_type: Target entity type

    Returns:
        Dict of field name to ExtractedField
    """
    fields = {}

    # Get field mappings for this document/entity combination
    type_mappings = FIELD_MAPPINGS.get(document_type, {})
    entity_mappings = type_mappings.get(entity_type, {})

    if not entity_mappings:
        logger.warning(f"No field mappings for {document_type.value}/{entity_type.value}")
        return fields

    # Extract each field
    for label, field_name in entity_mappings.items():
        value = _extract_field_value(text, label, document_type)
        if value:
            validated, message = _validate_field(field_name, value)
            fields[field_name] = ExtractedField(
                field_name=field_name,
                value=value,
                confidence=0.8 if validated else 0.5,  # Base confidence
                source=f"pattern_match_{label}",
                validated=validated,
                validation_message=message if not validated else None,
            )

    # Special extractions based on document type
    if document_type == DocumentType.ID_DOCUMENT:
        _extract_id_document_special_fields(text, fields)
    elif document_type == DocumentType.PASSPORT:
        _extract_passport_fields(text, fields)
    elif document_type == DocumentType.DRIVERS_LICENSE:
        _extract_drivers_license_fields(text, fields)
    elif document_type in [DocumentType.BANK_DETAILS, DocumentType.BANK_CONFIRMATION]:
        _extract_bank_special_fields(text, fields, entity_type)

    return fields


def _extract_field_value(text: str, label: str, doc_type: DocumentType) -> Optional[str]:
    """Extract a field value from text using various patterns."""

    # Determine what type of value we're looking for based on field name
    is_name_field = any(x in label.lower() for x in ['surname', 'nom', 'name', 'nachname', 'apellido', 'cognome', 'achternaam'])
    is_date_field = any(x in label.lower() for x in ['date', 'datum', 'fecha', 'data', 'birth', 'expiry', 'issue', 'naissance'])
    is_nationality_field = any(x in label.lower() for x in ['nationality', 'nationalité', 'nacionalidad', 'citizen'])

    # Pattern 1: "Label: Value" - extract value after colon, stop at next field or newline
    # Use negative lookahead to stop at common field separators
    pattern1 = re.compile(
        rf"{re.escape(label)}\s*:\s*([^:\n]+?)(?=\s*(?:[A-Z][a-z]+\s*(?:/|:)|$|\n))",
        re.IGNORECASE
    )
    match = pattern1.search(text)
    if match:
        value = match.group(1).strip()
        # For name fields, reject if it's purely numeric (likely an ID number)
        if is_name_field and re.match(r'^\d+$', value):
            pass  # Skip this match, try other patterns
        # For date fields, validate it looks like a date
        elif is_date_field and not re.search(r'\d', value):
            pass  # Skip if no digits (not a date)
        elif value:
            return value

    # Pattern 2: Simpler "Label: Value" to end of segment
    pattern2 = re.compile(rf"{re.escape(label)}\s*:\s*([A-Za-z0-9][^\n:]*)", re.IGNORECASE)
    match = pattern2.search(text)
    if match:
        value = match.group(1).strip()
        # Clean up - remove trailing slashes and other labels
        value = re.split(r'\s+[A-Z][a-z]+\s*/\s*', value)[0].strip()
        value = re.split(r'\s{2,}', value)[0].strip()  # Split on multiple spaces

        if is_name_field and re.match(r'^\d+$', value):
            pass  # Skip numeric values for name fields
        elif value:
            return value

    # Pattern 3: "Label Value" on same line (no colon)
    pattern3 = re.compile(rf"{re.escape(label)}\s+([A-Za-z][A-Za-z\s\-']+?)(?=\s*[A-Z][a-z]+|\s*$|\n)", re.IGNORECASE)
    match = pattern3.search(text)
    if match and is_name_field:
        value = match.group(1).strip()
        if value and not re.match(r'^\d+$', value):
            return value

    # Special patterns based on document type
    if doc_type == DocumentType.ID_DOCUMENT:
        # Only match ID number for ID-specific fields
        if "id" in label.lower() and "identity" in label.lower():
            id_match = re.search(r"\b(\d{13})\b", text)
            if id_match:
                return id_match.group(1)

    if doc_type in [DocumentType.BANK_DETAILS, DocumentType.BANK_CONFIRMATION]:
        if "account" in label.lower():
            acc_match = re.search(r"\b(\d{9,12})\b", text)
            if acc_match:
                return acc_match.group(1)
        elif "branch" in label.lower():
            branch_match = re.search(r"\b(\d{6})\b", text)
            if branch_match:
                return branch_match.group(1)

    if doc_type == DocumentType.CIPC_REGISTRATION and "registration" in label.lower():
        cipc_match = re.search(r"\b(\d{4}/\d{6}/\d{2})\b", text)
        if cipc_match:
            return cipc_match.group(1)

    return None


def _validate_field(field_name: str, value: str) -> Tuple[bool, Optional[str]]:
    """Validate a field value."""
    if field_name == "idNumber":
        return validate_sa_id(value)
    elif field_name in ["bankAccountNumber", "accountNumber"]:
        return validate_bank_account(value)
    elif field_name in ["bankBranchCode", "branchCode"]:
        return validate_branch_code(value)
    elif field_name == "registrationNumber":
        return validate_cipc_registration(value)
    elif field_name == "taxNumber":
        return validate_tax_number(value)

    # No specific validation, assume valid
    return True, None


def validate_sa_id(id_number: str) -> Tuple[bool, Optional[str]]:
    """Validate SA ID using Luhn algorithm variant."""
    clean_id = re.sub(r"\s", "", id_number)

    if not re.match(r"^\d{13}$", clean_id):
        return False, "SA ID must be exactly 13 digits"

    digits = [int(d) for d in clean_id]

    # Luhn algorithm for SA ID
    total = 0
    for i in range(12):
        digit = digits[i]
        if i % 2 == 1:
            digit *= 2
            if digit > 9:
                digit -= 9
        total += digit

    check_digit = (10 - (total % 10)) % 10
    if check_digit != digits[12]:
        return False, "Invalid SA ID checksum"

    # Validate date portion
    month = int(clean_id[2:4])
    day = int(clean_id[4:6])

    if month < 1 or month > 12:
        return False, "Invalid birth month in SA ID"
    if day < 1 or day > 31:
        return False, "Invalid birth day in SA ID"

    return True, None


def validate_bank_account(account: str) -> Tuple[bool, Optional[str]]:
    """Validate bank account number format."""
    clean_account = re.sub(r"[\s-]", "", account)
    if not re.match(r"^\d{9,12}$", clean_account):
        return False, "Bank account must be 9-12 digits"
    return True, None


def validate_branch_code(code: str) -> Tuple[bool, Optional[str]]:
    """Validate branch code format."""
    clean_code = re.sub(r"[\s-]", "", code)
    if not re.match(r"^\d{6}$", clean_code):
        return False, "Branch code must be exactly 6 digits"
    return True, None


def validate_cipc_registration(reg: str) -> Tuple[bool, Optional[str]]:
    """Validate CIPC registration number format."""
    clean_reg = re.sub(r"\s", "", reg)
    if not re.match(r"^\d{4}/\d{6}/\d{2}$", clean_reg):
        return False, "CIPC registration must be in format YYYY/NNNNNN/NN"
    return True, None


def validate_tax_number(tax: str) -> Tuple[bool, Optional[str]]:
    """Validate tax number format."""
    clean_tax = re.sub(r"[\s-]", "", tax)
    if not re.match(r"^\d{10}$", clean_tax):
        return False, "Tax number must be exactly 10 digits"
    return True, None


def _extract_id_document_special_fields(text: str, fields: Dict[str, ExtractedField]):
    """Extract special fields from SA ID document or passport."""
    id_number = None

    # Extract ID number if not already found
    if "idNumber" not in fields:
        id_match = re.search(r"\b(\d{13})\b", text)
        if id_match:
            id_number = id_match.group(1)
            validated, message = validate_sa_id(id_number)
            fields["idNumber"] = ExtractedField(
                field_name="idNumber",
                value=id_number,
                confidence=0.9 if validated else 0.6,
                source="regex_13_digit",
                validated=validated,
                validation_message=message if not validated else None,
            )
    else:
        # ID number was already extracted, use it for derivation
        id_number = fields["idNumber"].value

    # Extract derived fields from SA ID number (always, not just when idNumber is new)
    if id_number and len(id_number) == 13 and id_number.isdigit():
        validated, _ = validate_sa_id(id_number)
        if validated:
            # Date of birth (YYMMDD from first 6 digits)
            yy = id_number[:2]
            mm = id_number[2:4]
            dd = id_number[4:6]
            year = int(yy)
            full_year = 2000 + year if year <= 29 else 1900 + year
            dob = f"{full_year}-{mm}-{dd}"

            # ALWAYS overwrite dateOfBirth from SA ID - more reliable than OCR
            fields["dateOfBirth"] = ExtractedField(
                field_name="dateOfBirth",
                value=dob,
                confidence=0.95,
                source="derived_from_id",
                validated=True,
            )

            # Gender (digits 7-10) - ALWAYS overwrite from SA ID
            gender_digits = int(id_number[6:10])
            gender = "male" if gender_digits >= 5000 else "female"

            fields["gender"] = ExtractedField(
                field_name="gender",
                value=gender,
                confidence=0.95,
                source="derived_from_id",
                validated=True,
            )

            # Citizenship indicator (digit 11): 0 = SA citizen, 1 = permanent resident
            citizen_digit = int(id_number[10])
            if citizen_digit == 0:
                # SA citizen - nationality is always RSA
                fields["nationality"] = ExtractedField(
                    field_name="nationality",
                    value="RSA",
                    confidence=0.95,
                    source="derived_from_id",
                    validated=True,
                )

    # Extract SA Smart ID card issued date - ALWAYS run for ID documents
    # Format: "This card has been issued by the 10 NOV 2016 Department of Home Affairs"
    # This pattern is more specific than generic extraction, so always overwrite
    upper_text = text.upper()
    sa_id_issue_match = re.search(
        r"(?:ISSUED|UITGEREIK)\s+(?:BY\s+THE|DEUR\s+DIE)?\s*(\d{1,2})\s*([A-Z]{3})\s*(\d{4})",
        upper_text
    )
    if sa_id_issue_match:
        day = sa_id_issue_match.group(1).zfill(2)
        month_str = sa_id_issue_match.group(2)
        year = sa_id_issue_match.group(3)
        month_map = {"JAN": "01", "FEB": "02", "MAR": "03", "APR": "04", "MAY": "05", "JUN": "06",
                    "JUL": "07", "AUG": "08", "SEP": "09", "OCT": "10", "NOV": "11", "DEC": "12"}
        month = month_map.get(month_str, "01")
        # Always overwrite - this pattern is more specific than generic extraction
        fields["issuedDate"] = ExtractedField(
            field_name="issuedDate",
            value=f"{year}-{month}-{day}",
            confidence=0.95,  # Higher confidence for specific pattern
            source="regex_sa_id_issue",
            validated=True,
        )

    # Extract passport-specific fields from text
    _extract_passport_fields(text, fields)


def _extract_passport_fields(text: str, fields: Dict[str, ExtractedField]):
    """Extract passport-specific fields from text (international passports)."""
    upper_text = text.upper()

    # Check for passport indicators in multiple languages
    passport_indicators = [
        "PASSPORT", "PASSEPORT", "REISEPASS", "PASAPORTE",
        "PASSAPORTE", "PASSAPORTO", "PASPOORT", "TRAVEL DOCUMENT"
    ]
    is_passport = any(indicator in upper_text for indicator in passport_indicators)

    if not is_passport:
        return

    # Extract passport number - various formats:
    # - A09060091 (SA: 1 letter + 8-9 digits)
    # - AB1234567 (UK/EU: 2 letters + 7 digits)
    # - 123456789 (US: 9 digits)
    # - L01234567 (Canadian: 1 letter + 8 digits)
    if "passportNumber" not in fields:
        # SA passport format: "Passport No / No du passeport PA ZAF A09060091"
        # Note: PA = Type, ZAF = country, A09060091 = actual passport number
        passport_patterns = [
            # SA format: After country code (ZAF, etc)
            r"\bPA\s+[A-Z]{3}\s+([A-Z]\d{8,9})\b",
            # Generic: PASSPORT NO ... number (allow anything between)
            r"(?:PASSPORT|PASSEPORT)\s*(?:NO|NR|NUMBER)?\s*[:\s./]*(?:[A-Z]{2,3}\s+)?(?:[A-Z]{3}\s+)?([A-Z]{1,2}\d{6,9})\b",
            # Just the number format when document is known to be passport
            r"\b([A-Z]\d{8,9})\b",  # SA: A + 8-9 digits
            r"\b([A-Z]{2}\d{7})\b",  # EU: 2 letters + 7 digits
        ]
        for pattern in passport_patterns:
            passport_match = re.search(pattern, upper_text)
            if passport_match:
                passport_num = passport_match.group(1)
                # Validate it looks like a passport number (not an ID number)
                if passport_num and not re.match(r'^\d{13}$', passport_num):  # Exclude SA ID numbers
                    fields["passportNumber"] = ExtractedField(
                        field_name="passportNumber",
                        value=passport_num,
                        confidence=0.85,
                        source="regex_passport_no",
                        validated=True,
                    )
                    break

        # Fallback: Try numeric-only format (US passports)
        if "passportNumber" not in fields:
            numeric_match = re.search(
                r"(?:PASSPORT|PASSEPORT)\s*(?:NO|NUMBER)?[:\s./]*(\d{9})\b",
                upper_text
            )
            if numeric_match:
                fields["passportNumber"] = ExtractedField(
                    field_name="passportNumber",
                    value=numeric_match.group(1),
                    confidence=0.80,
                    source="regex_passport_numeric",
                    validated=True,
                )

    # Extract names (Surname / Given names) - handle bilingual format
    if "lastName" not in fields:
        # Pattern for "Surname / Nom: VAN VUUREN" or "Surname / Nom\nVAN VUUREN"
        surname_patterns = [
            r"SURNAME\s*/\s*NOM[:\s]*([A-Z][A-Z\s\-']+?)(?:\n|GIVEN|$)",
            r"(?:SURNAME|NOM)[:\s]+([A-Z][A-Z\s\-']+?)(?:\n|GIVEN|PRENOM|$)",
        ]
        for pattern in surname_patterns:
            surname_match = re.search(pattern, upper_text)
            if surname_match:
                value = surname_match.group(1).strip()
                # Exclude if it's numeric or too short
                if value and not re.match(r'^\d+$', value) and len(value) > 1:
                    fields["lastName"] = ExtractedField(
                        field_name="lastName",
                        value=value.title(),
                        confidence=0.85,
                        source="regex_surname",
                        validated=True,
                    )
                    break

    if "firstName" not in fields:
        # Pattern for "Given names / Prénoms: JAN HENDRIK"
        names_patterns = [
            r"GIVEN\s*NAMES?\s*/\s*PR[EÉ]NOMS?[:\s]*([A-Z][A-Z\s\-']+?)(?:\n|NATIONAL|DATE|$)",
            r"(?:GIVEN\s*NAMES?|PR[EÉ]NOMS?)[:\s]+([A-Z][A-Z\s\-']+?)(?:\n|NATIONAL|DATE|$)",
        ]
        for pattern in names_patterns:
            names_match = re.search(pattern, upper_text)
            if names_match:
                value = names_match.group(1).strip()
                if value and not re.match(r'^\d+$', value) and len(value) > 1:
                    fields["firstName"] = ExtractedField(
                        field_name="firstName",
                        value=value.title(),
                        confidence=0.85,
                        source="regex_given_names",
                        validated=True,
                    )
                    break

    # Extract dates from passport - OCR often runs fields together
    # So we find all DD MMM YYYY dates and match them to nearby labels
    month_map = {"JAN": "01", "FEB": "02", "MAR": "03", "APR": "04", "MAY": "05", "JUN": "06",
                "JUL": "07", "AUG": "08", "SEP": "09", "OCT": "10", "NOV": "11", "DEC": "12"}

    # Find all dates in DD MMM YYYY format
    date_pattern = r"(\d{1,2})\s*([A-Z]{3})\s*(\d{4})"
    all_dates = list(re.finditer(date_pattern, upper_text))

    # Extract date of birth - look for date near "BIRTH" keyword
    if "dateOfBirth" not in fields:
        birth_pos = upper_text.find("BIRTH")
        if birth_pos >= 0:
            # Find the closest date after "BIRTH"
            for date_match in all_dates:
                if date_match.start() > birth_pos and date_match.start() < birth_pos + 100:
                    year = int(date_match.group(3))
                    # DOB should be in the past (1900-2020)
                    if 1900 <= year <= 2020:
                        day = date_match.group(1).zfill(2)
                        month = month_map.get(date_match.group(2), "01")
                        fields["dateOfBirth"] = ExtractedField(
                            field_name="dateOfBirth",
                            value=f"{year}-{month}-{day}",
                            confidence=0.90,
                            source="regex_passport_dob",
                            validated=True,
                        )
                        break

    # Extract date of issue - look for date near "ISSUE" keyword
    if "issuedDate" not in fields:
        issue_pos = upper_text.find("ISSUE")
        if issue_pos >= 0:
            for date_match in all_dates:
                if date_match.start() > issue_pos and date_match.start() < issue_pos + 100:
                    year = int(date_match.group(3))
                    # Issue date should be recent (2000-2030)
                    if 2000 <= year <= 2030:
                        day = date_match.group(1).zfill(2)
                        month = month_map.get(date_match.group(2), "01")
                        fields["issuedDate"] = ExtractedField(
                            field_name="issuedDate",
                            value=f"{year}-{month}-{day}",
                            confidence=0.90,
                            source="regex_passport_issue",
                            validated=True,
                        )
                        break

    # Extract date of expiry - look for date near "EXPIR" keyword
    if "expiryDate" not in fields:
        expiry_pos = max(upper_text.find("EXPIRY"), upper_text.find("EXPIRA"), upper_text.find("D'EXPIRATION"))
        if expiry_pos >= 0:
            for date_match in all_dates:
                if date_match.start() > expiry_pos and date_match.start() < expiry_pos + 100:
                    year = int(date_match.group(3))
                    # Expiry date should be in the future or recent past (2020-2040)
                    if 2020 <= year <= 2040:
                        day = date_match.group(1).zfill(2)
                        month = month_map.get(date_match.group(2), "01")
                        fields["expiryDate"] = ExtractedField(
                            field_name="expiryDate",
                            value=f"{year}-{month}-{day}",
                            confidence=0.90,
                            source="regex_passport_expiry",
                            validated=True,
                        )
                        break

    # Extract gender/sex
    if "gender" not in fields:
        sex_match = re.search(r"SEX[:\s/]*([MF])\b", upper_text)
        if sex_match:
            gender = "male" if sex_match.group(1) == "M" else "female"
            fields["gender"] = ExtractedField(
                field_name="gender",
                value=gender,
                confidence=0.95,
                source="regex_passport_sex",
                validated=True,
            )

    # Extract nationality - handle bilingual format "SOUTH AFRICAN / SUD-AFRICAIN"
    # Always try passport-specific extraction (it's more accurate than general extraction)
    # Pattern for "Nationality / Nationalité: SOUTH AFRICAN / SUD-AFRICAIN"
    # Use greedy match up to the slash separator for bilingual
    nat_patterns = [
        r"NATIONALITY\s*/\s*NATIONALIT[EÉ][:\s]*([A-Z][A-Z\s\-]+)\s*/",  # Match up to slash
        r"NATIONAL(?:ITY|IT[EÉ])[:\s]+([A-Z][A-Z\s\-]+)\s*/",  # Match up to slash
        r"NATIONALITY\s*/\s*NATIONALIT[EÉ][:\s]*([A-Z][A-Z\s\-]+?)(?:\n|DATE|IDENTITY|$)",
        r"NATIONAL(?:ITY|IT[EÉ])[:\s]+([A-Z][A-Z\s\-]+?)(?:\n|DATE|$)",
    ]
    for pattern in nat_patterns:
        nat_match = re.search(pattern, upper_text)
        if nat_match:
            nationality = nat_match.group(1).strip()
            # Clean up - remove trailing spaces
            nationality = nationality.strip()
            if nationality and not re.match(r'^\d+$', nationality) and len(nationality) > 2:
                # Overwrite any previous extraction with this more accurate one
                fields["nationality"] = ExtractedField(
                    field_name="nationality",
                    value=nationality.title(),
                    confidence=0.90,  # Higher confidence for passport-specific extraction
                    source="regex_passport_nationality",
                    validated=True,
                )
                break

    # Extract passport country code (issuing country)
    # Pattern: "Country code / Code du pays ... ZAF" or "PA ZAF" in document header
    if "passportCountry" not in fields:
        # Try to find 3-letter country code near "Country code" or after "PA"
        country_patterns = [
            r"COUNTRY\s*CODE[:\s/]*(?:[A-Z]{2}\s+)?([A-Z]{3})\b",  # "Country code / Code du pays ... ZAF"
            r"\bPA\s+([A-Z]{3})\b",  # "PA ZAF" - Type + Country code
            r"CODE\s*(?:/\s*CODE)?[:\s/]*([A-Z]{3})\b",  # Generic "Code: ZAF"
        ]
        for pattern in country_patterns:
            country_match = re.search(pattern, upper_text)
            if country_match:
                country_code = country_match.group(1)
                # Validate it's a plausible country code (3 uppercase letters)
                if country_code and len(country_code) == 3:
                    # Map common country codes to names
                    country_names = {
                        "ZAF": "South Africa", "GBR": "United Kingdom", "USA": "United States",
                        "ZWE": "Zimbabwe", "NAM": "Namibia", "BWA": "Botswana",
                        "MOZ": "Mozambique", "ZMB": "Zambia", "KEN": "Kenya",
                        "NGA": "Nigeria", "GHA": "Ghana", "IND": "India",
                        "PAK": "Pakistan", "BGD": "Bangladesh", "PHL": "Philippines",
                    }
                    country_name = country_names.get(country_code, country_code)
                    fields["passportCountry"] = ExtractedField(
                        field_name="passportCountry",
                        value=country_name,
                        confidence=0.85,
                        source="regex_passport_country",
                        validated=True,
                    )
                    break


def _extract_drivers_license_fields(text: str, fields: Dict[str, ExtractedField]):
    """Extract driver's license specific fields from text (SA licenses)."""
    upper_text = text.upper()
    # Also create a cleaned version with OCR special chars replaced
    cleaned_text = upper_text.replace('¢', '8').replace('¤', '8').replace('©', 'C')

    # Check for license indicators (handle OCR variations)
    license_indicators = [
        "DRIVING LICENCE", "DRIVER'S LICENSE", "BESTUURSLISENSIE",
        "DRIVING LICENSE", "LIC. NO", "LISENSIENR", "LISEASIENR",
        "BESTUURSL'SENSIE", "BESTUURSL SENSIE"
    ]
    is_license = any(indicator in upper_text for indicator in license_indicators)

    if not is_license:
        return

    # Extract license number - SA format: alphanumeric like "3JO004U08RD49"
    # OCR often produces: "Lic. No./Liseasienr.: 3JO004U0¢8RD49" (¢ for 8)
    if "licenseNumber" not in fields:
        license_patterns = [
            # Bilingual format with OCR variations: "Lic. No./Liseasienr.: VALUE"
            r"LIC\.?\s*(?:NO\.?|NR\.?)\s*/?\s*L[I1]S[EA]+[S5]?[I1]?E?N?[R1I]?\.?\s*:?\s*([A-Z0-9¢¤©]{8,15})",
            # English only: "Licence No.: VALUE" or "License Number: VALUE"
            r"LICEN[CS]E?\s*(?:NO\.?|NUMBER|NR\.?)?\s*:?\s*([A-Z0-9¢¤©]{8,15})",
            # Generic alphanumeric license number (allowing OCR special chars)
            r"\b([0-9][A-Z]{1,2}[0-9¢¤]{3,6}[A-Z][0-9¢¤]{2}[A-Z0-9¢¤]{2,4})\b",
        ]
        for pattern in license_patterns:
            match = re.search(pattern, cleaned_text) or re.search(pattern, upper_text)
            if match:
                license_num = match.group(1).strip()
                # Clean OCR special chars from the extracted value
                license_num = license_num.replace('¢', '8').replace('¤', '8').replace('©', 'C')
                if license_num and len(license_num) >= 8:
                    fields["licenseNumber"] = ExtractedField(
                        field_name="licenseNumber",
                        value=license_num,
                        confidence=0.90,
                        source="regex_license_no",
                        validated=True,
                    )
                    break

    # Extract vehicle codes - SA format: "Code: EB" or "Vehicle Code: EB, C1"
    # OCR often produces: "Cade. ade: EB" or "C0DE: EB"
    if "licenseCodes" not in fields:
        code_patterns = [
            # Handle OCR misreads: "Cade. ade: EB", "Code/Kode: EB"
            r"(?:VEHICLE\s*)?C[O0A]DE\.?\s*(?:[/\.]?\s*(?:K[O0]DE|ADE))?\.?\s*:?\s*([A-Z]{1,2}[0-9]?(?:\s*,?\s*[A-Z]{1,2}[0-9]?)*)",
            # Just "Code: EB" or "Cade: EB"
            r"\bC[O0A]DE\.?\s*:?\s*([A-Z]{1,2}[0-9]?)\b",
            # Look for common SA license codes pattern (EB, EC, C1, A, B)
            r"\b(E[ABC]|C[01]|[AB])\s+[0-9]\s*(?:VEH|$)",
        ]
        for pattern in code_patterns:
            match = re.search(pattern, upper_text)
            if match:
                codes = match.group(1).strip()
                # Clean up - remove extra spaces and normalize
                codes = re.sub(r'\s+', ', ', codes.strip())
                if codes and len(codes) >= 1:
                    fields["licenseCodes"] = ExtractedField(
                        field_name="licenseCodes",
                        value=codes,
                        confidence=0.85,
                        source="regex_vehicle_code",
                        validated=True,
                    )
                    break

    # Extract validity dates - SA format: "Valid/Geldig: 08/11/2016 - 18/11/2021"
    # Also handles: "Valia/Geidig" (OCR misread)
    date_pattern = r"(?:VALID|VALIA|GELDIG|GEIDIG)\s*/?\s*(?:VALID|VALIA|GELDIG|GEIDIG)?\s*:?\s*(\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4})\s*[-–]\s*(\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4})"
    date_match = re.search(date_pattern, upper_text)
    if date_match:
        valid_from = date_match.group(1)
        valid_to = date_match.group(2)

        if "validFrom" not in fields and valid_from:
            # Convert DD/MM/YYYY to ISO format YYYY-MM-DD
            from_parts = re.split(r'[/\-\.]', valid_from)
            if len(from_parts) == 3:
                day, month, year = from_parts
                if len(year) == 2:
                    year = '20' + year if int(year) < 50 else '19' + year
                iso_date = f"{year}-{month.zfill(2)}-{day.zfill(2)}"
                fields["validFrom"] = ExtractedField(
                    field_name="validFrom",
                    value=iso_date,
                    confidence=0.85,
                    source="regex_valid_from",
                    validated=True,
                )

        if "validTo" not in fields and valid_to:
            to_parts = re.split(r'[/\-\.]', valid_to)
            if len(to_parts) == 3:
                day, month, year = to_parts
                if len(year) == 2:
                    year = '20' + year if int(year) < 50 else '19' + year
                # Handle truncated year like "202" -> "2021" or "2027"
                if len(year) == 3:
                    year = year + '1'  # Assume it was truncated
                iso_date = f"{year}-{month.zfill(2)}-{day.zfill(2)}"
                fields["validTo"] = ExtractedField(
                    field_name="validTo",
                    value=iso_date,
                    confidence=0.85,
                    source="regex_valid_to",
                    validated=True,
                )

    # Extract first issue date - "First issue/Eerste uitreiking: 2/08/2001"
    if "firstIssued" not in fields:
        first_issue_pattern = r"(?:FIRST\s*ISSUE|EERSTE?\s*UITREIK(?:ING)?)\s*/?\s*(?:FIRST\s*ISSUE|EERSTE?\s*UITREIK(?:ING)?)?\s*:?\s*(\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4})"
        first_match = re.search(first_issue_pattern, upper_text)
        if first_match:
            first_date = first_match.group(1)
            parts = re.split(r'[/\-\.]', first_date)
            if len(parts) == 3:
                day, month, year = parts
                if len(year) == 2:
                    year = '20' + year if int(year) < 50 else '19' + year
                iso_date = f"{year}-{month.zfill(2)}-{day.zfill(2)}"
                fields["firstIssued"] = ExtractedField(
                    field_name="firstIssued",
                    value=iso_date,
                    confidence=0.80,
                    source="regex_first_issue",
                    validated=True,
                )

    # Extract restrictions - "Restr./Beperk.: 00"
    if "restrictions" not in fields:
        restr_pattern = r"(?:RESTR(?:ICTIONS?)?|BEPERK(?:INGS?)?)\s*/?\s*(?:RESTR(?:ICTIONS?)?|BEPERK(?:INGS?)?)?\s*:?\s*([A-Z0-9]{1,5})"
        restr_match = re.search(restr_pattern, upper_text)
        if restr_match:
            restrictions = restr_match.group(1).strip()
            if restrictions:
                fields["restrictions"] = ExtractedField(
                    field_name="restrictions",
                    value=restrictions,
                    confidence=0.80,
                    source="regex_restrictions",
                    validated=True,
                )


def _extract_bank_special_fields(
    text: str,
    fields: Dict[str, ExtractedField],
    entity_type: EntityType
):
    """Extract special fields from bank documents."""
    # Try to identify bank from branch code
    branch_field = "bankBranchCode" if entity_type == EntityType.STAFF else "branchCode"
    bank_field = "bankName"

    if branch_field in fields and bank_field not in fields:
        branch_code = fields[branch_field].value.replace(" ", "").replace("-", "")
        bank_name = SA_BANK_CODES.get(branch_code)
        if bank_name:
            fields[bank_field] = ExtractedField(
                field_name=bank_field,
                value=bank_name,
                confidence=0.95,
                source="bank_lookup_from_branch",
                validated=True,
            )


def process_document(
    text: str,
    entity_type: str
) -> ExtractionResult:
    """
    Main entry point for document processing.

    Args:
        text: OCR extracted text
        entity_type: 'staff' or 'contractor'

    Returns:
        ExtractionResult with classification and fields
    """
    entity = EntityType(entity_type)
    classification = classify_document(text)

    extracted_fields = {}
    if classification.document_type != DocumentType.UNKNOWN:
        extracted_fields = extract_fields(
            text,
            classification.document_type,
            entity
        )

    return ExtractionResult(
        classification=classification,
        extracted_fields=extracted_fields,
        entity_type=entity,
    )
