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
        # === SA ID Documents ===
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

        # === International Passports ===
        # English
        "PASSPORT",
        "GIVEN NAMES",
        "DATE OF EXPIRY",
        "DATE OF ISSUE",
        "PASSPORT NO",
        "PLACE OF BIRTH",
        "DATE OF BIRTH",
        "AUTHORITY",
        "TYPE",
        "CODE",
        "MACHINE READABLE",
        # French
        "PASSEPORT",
        "NOM",
        "PRÉNOMS",
        "DATE DE NAISSANCE",
        "LIEU DE NAISSANCE",
        "DATE DE DÉLIVRANCE",
        "DATE D'EXPIRATION",
        # German
        "REISEPASS",
        "NACHNAME",
        "VORNAMEN",
        "GEBURTSDATUM",
        "GEBURTSORT",
        "AUSSTELLUNGSDATUM",
        "GÜLTIG BIS",
        # Spanish
        "PASAPORTE",
        "APELLIDOS",
        "NOMBRE",
        "FECHA DE NACIMIENTO",
        "LUGAR DE NACIMIENTO",
        "FECHA DE EXPEDICIÓN",
        "FECHA DE CADUCIDAD",
        # Portuguese
        "PASSAPORTE",
        "APELIDOS",
        "NOMES",
        "DATA DE NASCIMENTO",
        "LOCAL DE NASCIMENTO",
        # Italian
        "PASSAPORTO",
        "COGNOME",
        "DATA DI NASCITA",
        "LUOGO DI NASCITA",
        # Dutch
        "PASPOORT",
        "ACHTERNAAM",
        "VOORNAMEN",
        "GEBOORTEDATUM",
        "GEBOORTEPLAATS",
        # Generic international
        "MRZ",
        "ICAO",
        "TRAVEL DOCUMENT",
        "ISSUING STATE",
        "HOLDER",
        "EXPIRY",
        "VALID",
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
        r"\d{13}",  # SA ID number (13 digits)
        r"\d{1,2}\s*(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s*\d{4}",  # Date: "03 FEB 1978"
        r"[A-Z]{1,2}\d{6,9}",  # Generic passport number (1-2 letters + 6-9 digits)
        r"\d{9}",  # Numeric passport numbers (some countries)
        r"P[<>][A-Z]{3}",  # MRZ first line pattern (P<XXX or P>XXX)
        r"[A-Z0-9<]{30,44}",  # MRZ line pattern (30-44 alphanumeric chars with <)
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
        keyword_score = len(matched_kw) / len(keywords) if keywords else 0

        # Count pattern matches
        patterns = DOCUMENT_PATTERNS.get(doc_type, [])
        matched_pt = []
        for pattern in patterns:
            if re.search(pattern, text, re.IGNORECASE):
                matched_pt.append(pattern)
        pattern_score = len(matched_pt) / len(patterns) if patterns else 0

        # Combined score (keywords weighted more)
        total_score = keyword_score * 0.6 + pattern_score * 0.4

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
    elif document_type in [DocumentType.BANK_DETAILS, DocumentType.BANK_CONFIRMATION]:
        _extract_bank_special_fields(text, fields, entity_type)

    return fields


def _extract_field_value(text: str, label: str, doc_type: DocumentType) -> Optional[str]:
    """Extract a field value from text using various patterns."""
    # Pattern 1: "Label: Value" or "Label : Value"
    pattern1 = re.compile(rf"{re.escape(label)}\s*:\s*([^\n]+)", re.IGNORECASE)
    match = pattern1.search(text)
    if match:
        return match.group(1).strip()

    # Pattern 2: "Label Value" on same line
    pattern2 = re.compile(rf"{re.escape(label)}\s+([A-Za-z0-9][^\n]{{0,50}})", re.IGNORECASE)
    match = pattern2.search(text)
    if match:
        return match.group(1).strip()

    # Special patterns based on document type
    if doc_type == DocumentType.ID_DOCUMENT and "id" in label.lower():
        # Look for 13-digit SA ID
        id_match = re.search(r"\b(\d{13})\b", text)
        if id_match:
            return id_match.group(1)

    if doc_type in [DocumentType.BANK_DETAILS, DocumentType.BANK_CONFIRMATION]:
        if "account" in label.lower():
            # Look for 9-12 digit account number
            acc_match = re.search(r"\b(\d{9,12})\b", text)
            if acc_match:
                return acc_match.group(1)
        elif "branch" in label.lower():
            # Look for 6-digit branch code
            branch_match = re.search(r"\b(\d{6})\b", text)
            if branch_match:
                return branch_match.group(1)

    if doc_type == DocumentType.CIPC_REGISTRATION and "registration" in label.lower():
        # Look for CIPC format YYYY/NNNNNN/NN
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

            if "dateOfBirth" not in fields:
                fields["dateOfBirth"] = ExtractedField(
                    field_name="dateOfBirth",
                    value=dob,
                    confidence=0.95,
                    source="derived_from_id",
                    validated=True,
                )

            # Gender (digits 7-10)
            gender_digits = int(id_number[6:10])
            gender = "male" if gender_digits >= 5000 else "female"

            if "gender" not in fields:
                fields["gender"] = ExtractedField(
                    field_name="gender",
                    value=gender,
                    confidence=0.95,
                    source="derived_from_id",
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
        # Try letter+digits format first (most common)
        passport_match = re.search(
            r"(?:PASSPORT|PASSEPORT|REISEPASS|PASAPORTE|PASSAPORTO|PASPOORT)\s*"
            r"(?:NO|NR|NUMBER|NUMERO)?[:\s./]*([A-Z]{1,2}\d{6,9})",
            upper_text
        )
        if passport_match:
            fields["passportNumber"] = ExtractedField(
                field_name="passportNumber",
                value=passport_match.group(1),
                confidence=0.85,
                source="regex_passport_no",
                validated=True,
            )
        else:
            # Try numeric-only format (US passports)
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

    # Extract names (Surname / Given names)
    if "lastName" not in fields:
        surname_match = re.search(r"(?:SURNAME|SUMAME|NOM)[:\s/]*([A-Z][A-Z\s]+?)(?:\n|GIVEN|PRENOM|ATI)", upper_text)
        if surname_match:
            fields["lastName"] = ExtractedField(
                field_name="lastName",
                value=surname_match.group(1).strip().title(),
                confidence=0.80,
                source="regex_surname",
                validated=True,
            )

    if "firstName" not in fields:
        names_match = re.search(r"(?:GIVEN\s*NAMES?|PRÉNOMS?|PRENOMS?)[:\s/]*([A-Z][A-Z\s]+?)(?:\n|NATIONAL|DATE)", upper_text)
        if names_match:
            fields["firstName"] = ExtractedField(
                field_name="firstName",
                value=names_match.group(1).strip().title(),
                confidence=0.80,
                source="regex_given_names",
                validated=True,
            )

    # Extract date of birth (various formats: 03 FEB 1978, 1978-02-03, etc.)
    if "dateOfBirth" not in fields:
        # Try DD MMM YYYY format
        dob_match = re.search(r"DATE\s*(?:OF\s*)?BIRTH[:\s/]*(\d{1,2})\s*([A-Z]{3})\s*(\d{4})", upper_text)
        if dob_match:
            day = dob_match.group(1).zfill(2)
            month_str = dob_match.group(2)
            year = dob_match.group(3)
            month_map = {"JAN": "01", "FEB": "02", "MAR": "03", "APR": "04", "MAY": "05", "JUN": "06",
                        "JUL": "07", "AUG": "08", "SEP": "09", "OCT": "10", "NOV": "11", "DEC": "12"}
            month = month_map.get(month_str, "01")
            fields["dateOfBirth"] = ExtractedField(
                field_name="dateOfBirth",
                value=f"{year}-{month}-{day}",
                confidence=0.90,
                source="regex_passport_dob",
                validated=True,
            )

    # Extract date of issue
    if "issuedDate" not in fields:
        issue_match = re.search(r"DATE\s*(?:OF\s*)?ISSUE[:\s/]*(\d{1,2})\s*([A-Z]{3})\s*(\d{4})", upper_text)
        if issue_match:
            day = issue_match.group(1).zfill(2)
            month_str = issue_match.group(2)
            year = issue_match.group(3)
            month_map = {"JAN": "01", "FEB": "02", "MAR": "03", "APR": "04", "MAY": "05", "JUN": "06",
                        "JUL": "07", "AUG": "08", "SEP": "09", "OCT": "10", "NOV": "11", "DEC": "12"}
            month = month_map.get(month_str, "01")
            fields["issuedDate"] = ExtractedField(
                field_name="issuedDate",
                value=f"{year}-{month}-{day}",
                confidence=0.90,
                source="regex_passport_issue",
                validated=True,
            )

    # Extract date of expiry
    if "expiryDate" not in fields:
        expiry_match = re.search(r"DATE\s*(?:OF\s*)?EXPIR[YA][:\s/]*(\d{1,2})\s*([A-Z]{3})\s*(\d{4})", upper_text)
        if expiry_match:
            day = expiry_match.group(1).zfill(2)
            month_str = expiry_match.group(2)
            year = expiry_match.group(3)
            month_map = {"JAN": "01", "FEB": "02", "MAR": "03", "APR": "04", "MAY": "05", "JUN": "06",
                        "JUL": "07", "AUG": "08", "SEP": "09", "OCT": "10", "NOV": "11", "DEC": "12"}
            month = month_map.get(month_str, "01")
            fields["expiryDate"] = ExtractedField(
                field_name="expiryDate",
                value=f"{year}-{month}-{day}",
                confidence=0.90,
                source="regex_passport_expiry",
                validated=True,
            )

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

    # Extract nationality
    if "nationality" not in fields:
        nat_match = re.search(r"NATIONAL(?:ITY|ITE)[:\s/]*([A-Z][A-Z\s]+?)(?:\n|DATE|/)", upper_text)
        if nat_match:
            nationality = nat_match.group(1).strip()
            # Clean up common patterns
            nationality = nationality.replace("SOUTH AFRICAN", "South African").replace("SUD-AFRICAIN", "")
            fields["nationality"] = ExtractedField(
                field_name="nationality",
                value=nationality.strip().title() if nationality.strip() else "South African",
                confidence=0.85,
                source="regex_passport_nationality",
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
