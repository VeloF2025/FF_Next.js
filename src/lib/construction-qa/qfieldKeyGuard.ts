/**
 * Belt-and-braces denylist for QField MinIO keys handed to `mc` via an argv
 * array (never a shell). Parentheses and spaces are deliberately allowed —
 * iOS names duplicate photos `…03.54 (1).jpeg` and ~3% of pole_qa_photos keys
 * carry them; rejecting them rendered those photos as "missing".
 */
export const QFIELD_KEY_DENYLIST = /[;`$|&\\{}\[\]!#]/;
