#!/bin/bash
# =============================================================================
# Salesforce Bulk API v1 Job Failure Analyzer
# All text processing uses BSD awk/sed/grep only — macOS compatible.
#
# Usage:
#   ./analyze_bulk_job.sh <job_id> <sf_alias>          # Full API-based analysis
#   ./analyze_bulk_job.sh --list-jobs <sf_alias>       # List recent Bulk API jobs
#   ./analyze_bulk_job.sh --analyze-files <directory>  # Analyze locally downloaded CSVs
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Colors
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

DEBUG_LOG="debug.log"

log_debug()   { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"       | tee -a "${DEBUG_LOG}"; }
log_error()   { echo -e "${RED}[ERROR] $1${NC}"                 | tee -a "${DEBUG_LOG}"; }
log_success() { echo -e "${GREEN}[SUCCESS] $1${NC}"             | tee -a "${DEBUG_LOG}"; }
log_info()    { echo -e "${BLUE}[INFO] $1${NC}"                 | tee -a "${DEBUG_LOG}"; }

# ---------------------------------------------------------------------------
# extract_xml <file> <tag>
#   BSD sed — no grep -P, no gawk.
# ---------------------------------------------------------------------------
extract_xml() {
    sed -n "s/.*<${2}>\(.*\)<\/${2}>.*/\1/p" "$1" | head -1
}

# ---------------------------------------------------------------------------
# extract_failures <input_csv> <output_csv>
#
# Appends failure rows to output_csv (no header written here — caller does that).
#
# WHY AWK, not grep:
#   The Bulk API result CSV is fully quoted:
#       "Id","Success","Created","Error"
#       "001…","true","false",""          ← Created=false means *updated*, NOT a failure
#       "","false","true","INVALID_…"     ← Success=false is the actual failure
#   grep for "false" anywhere on the line hits the Created column on thousands
#   of rows.  We must isolate column 2 (Success) specifically.
#
# WHY reassemble cols 4+:
#   The Error field itself can contain commas, e.g.:
#       "REQUIRED_FIELD_MISSING:Required fields are missing: [LastName]:LastName --"
#   Simple -F',' field splitting breaks that into multiple awk fields.
# ---------------------------------------------------------------------------
extract_failures() {
    local input_file=$1
    local output_file=$2

    awk -F',' '
    NR == 1 { next }                              # skip header
    {
        success = $2;  gsub(/^"|"$/, "", success)  # strip quotes from col 2

        if (success == "false") {
            id      = $1;  gsub(/^"|"$/, "", id)
            created = $3;  gsub(/^"|"$/, "", created)

            # Reassemble error from col 4 onward, then strip outer quotes
            error = $4
            for (i = 5; i <= NF; i++) error = error "," $i
            gsub(/^"|"$/, "", error)

            print id "," success "," created "," error
        }
    }' "$input_file" >> "$output_file"
}

# ---------------------------------------------------------------------------
# summarize_by_signature <input_csv> <output_file>
#
# Level 1 rollup: group by "error signature" = code + field + entity.
# Each known Salesforce error code has its own processor function.
# Unknown codes route to proc_UNKNOWN (catch-all).
#
# ADDING A NEW ERROR CODE:
#   1. Add a function:  function proc_YOUR_CODE(error, ...) { ... return key }
#   2. Add one line in the dispatch block:
#        else if (code == "YOUR_CODE")  key = proc_YOUR_CODE(error)
#   That's it.  The rest of the pipeline is unchanged.
#
# PROCESSOR SIGNAL/NOISE RULES:
#   Signal (kept):  error code, field name, entity/object name
#   Noise  (stripped): specific record IDs, data values, email addresses
#   Unknown sub-patterns within a known code: preserve full message (safe default)
# ---------------------------------------------------------------------------
summarize_by_signature() {
    local input_file=$1
    local output_file=$2

    awk -F',' '
    # -----------------------------------------------------------------------
    # Processors — one function per known error code.
    # Local variables are declared as extra parameters after a whitespace gap
    # (standard awk idiom, required for BSD awk compatibility).
    # -----------------------------------------------------------------------

    function proc_INVALID_EMAIL_ADDRESS(error) {
        # Field is always Email.  The specific address is noise.
        return "INVALID_EMAIL_ADDRESS: field Email"
    }

    function proc_REQUIRED_FIELD_MISSING(error,    fb, fc, field) {
        # Field name inside [...] is the full signal.
        split(error, fb, "[")
        split(fb[2], fc, "]")
        field = fc[1]
        return "REQUIRED_FIELD_MISSING: field " field
    }

    function proc_INVALID_FIELD(error,    fb, fc, fd, field, entity, remainder) {
        # Two observed sub-patterns — structurally different problems:
        #   (a) Foreign key lookup failure: valid field, bad ID value
        #   (b) Invalid field name: the field itself does not exist
        if (index(error, "Foreign key external ID") > 0) {
            # "...Foreign key external ID: <NOISE> not found for field <FIELD> in entity <ENTITY>:--"
            split(error, fb, "not found for field ")
            remainder = fb[2]
            split(remainder, fc, " in entity ")
            field  = fc[1]
            split(fc[2], fd, ":")          # strip trailing ":--"
            entity = fd[1]
            return "INVALID_FIELD: foreign key <extId> not found for field " field " in entity " entity
        } else if (index(error, "Invalid field") > 0) {
            # "INVALID_FIELD:Invalid field: <field>"  — no noise
            split(error, fb, "Invalid field: ")
            field = fb[2]
            gsub(/:.*$/, "", field)
            return "INVALID_FIELD: invalid field " field
        } else {
            return "INVALID_FIELD: " error  # unknown sub-pattern — preserve
        }
    }

    function proc_DUPLICATE_VALUE(error,    fb, fc, field) {
        # Field in [...] is signal.  The duplicate value is noise.
        split(error, fb, "[")
        split(fb[2], fc, "]")
        field = fc[1]
        return "DUPLICATE_VALUE: field " field
    }

    function proc_INVALID_VALUE(error,    tmp, fb, field) {
        # "...invalid value for field: <NOISE>:<FIELD> --"
        # Field = last colon-segment before " --"
        tmp = error
        gsub(/ --$/, "", tmp)
        split(tmp, fb, ":")
        field = fb[length(fb)]
        return "INVALID_VALUE: field " field
    }

    function proc_INVALID_REFERENCE(error,    fb, fc, field) {
        # "...is invalid: <field>"  — field is the full signal
        split(error, fb, "is invalid: ")
        field = fb[2]
        gsub(/:.*$/, "", field)
        return "INVALID_REFERENCE: field " field
    }

    function proc_FIELD_INTEGRITY_EXCEPTION(error,    fb, fc, rest, field) {
        # "...failed: (<ID>)<field>"  — strip parens-wrapped record ID, keep field
        split(error, fb, "failed: ")
        rest = fb[2]
        split(rest, fc, ")")          # fc[2] = field name after the closing paren
        field = fc[2]
        return "FIELD_INTEGRITY_EXCEPTION: field " field
    }

    # -----------------------------------------------------------------------
    # Catch-all processor for unknown error codes.
    #
    # Salesforce error messages are structurally consistent even for codes we
    # have not explicitly cataloged.  This processor extracts signal tokens
    # heuristically rather than dumping the raw message:
    #
    #   1. Scan all colon-segments for __c / __r tokens — these are custom
    #      field or relationship names and are almost certainly signal.
    #   2. If the message contains "in entity <Name>", extract the entity.
    #   3. If neither found, fall back to code + second colon-segment
    #      (the static description).  This strips variable values that
    #      typically appear in segment 3+.
    #   4. If only two segments exist (code:description, no value to strip),
    #      return the full message — there is nothing to normalize.
    #
    # This will not be perfect for every possible SF error, but it will produce
    # useful signatures for the majority of cases without manual intervention.
    # -----------------------------------------------------------------------
    function proc_UNKNOWN(error, code,    segments, n, i, j, token, words, nw,
                          fields, nfields, entity, result) {
        n = split(error, segments, ":")

        # --- Extract entity if "in entity <Name>" is present ---
        if (index(error, "in entity ") > 0) {
            split(error, words, "in entity ")
            split(words[2], segments, /[: \t]/)
            for (j = 1; j <= length(segments); j++) {
                if (segments[j] != "") { entity = segments[j]; break }
            }
            # Re-split error on colons — segments array was clobbered
            n = split(error, segments, ":")
        }

        # --- Scan colon-segments for __c / __r tokens (custom fields) ---
        nfields = 0
        for (i = 1; i <= n; i++) {
            split(segments[i], words, /[ ,\t\[\]()]+/)
            for (j = 1; j <= length(words); j++) {
                token = words[j]
                if (token ~ /__c$/ || token ~ /__r$/) {
                    # Dedupe: only add if not already in fields[]
                    duplicate = 0
                    for (k = 1; k <= nfields; k++)
                        if (fields[k] == token) { duplicate = 1; break }
                    if (!duplicate) { nfields++; fields[nfields] = token }
                }
            }
        }

        # --- Build signature ---
        result = code
        if (nfields > 0) {
            result = result ": field"
            for (i = 1; i <= nfields; i++) result = result " " fields[i]
        }
        if (entity != "") {
            result = result " in " entity
        }

        # If we found no field or entity, fall back to code + static description
        if (nfields == 0 && entity == "") {
            if (n >= 3) {
                result = code ": " segments[2]
            } else {
                result = error   # only two segments — nothing to strip
            }
        }

        return result
    }

    # -----------------------------------------------------------------------
    # Main: reassemble error field, extract code, dispatch to processor
    # -----------------------------------------------------------------------
    NR == 1 { next }
    {
        error = $4
        for (i = 5; i <= NF; i++) error = error "," $i
        gsub(/^[ \t]+|[ \t]+$/, "", error)

        n = split(error, parts, ":")
        code = (n > 0) ? parts[1] : error

        # Dispatch to the appropriate processor
        if      (code == "INVALID_EMAIL_ADDRESS")      key = proc_INVALID_EMAIL_ADDRESS(error)
        else if (code == "REQUIRED_FIELD_MISSING")     key = proc_REQUIRED_FIELD_MISSING(error)
        else if (code == "INVALID_FIELD")              key = proc_INVALID_FIELD(error)
        else if (code == "DUPLICATE_VALUE")            key = proc_DUPLICATE_VALUE(error)
        else if (code == "INVALID_VALUE")              key = proc_INVALID_VALUE(error)
        else if (code == "INVALID_REFERENCE")          key = proc_INVALID_REFERENCE(error)
        else if (code == "FIELD_INTEGRITY_EXCEPTION")  key = proc_FIELD_INTEGRITY_EXCEPTION(error)
        else                                           key = proc_UNKNOWN(error, code)

        keys[key]++
        if (!(key in seen)) { order[++cnt] = key; seen[key] = 1 }
    }
    END {
        for (i = 1; i <= cnt; i++) {
            max_idx = i
            for (j = i + 1; j <= cnt; j++)
                if (keys[order[j]] > keys[order[max_idx]]) max_idx = j
            tmp = order[i]; order[i] = order[max_idx]; order[max_idx] = tmp
        }
        for (i = 1; i <= cnt; i++)
            printf "%5d | %s\n", keys[order[i]], order[i]
    }
    ' "$input_file" >> "$output_file"
}

# ---------------------------------------------------------------------------
# summarize_raw <input_csv> <output_file>
#
# Level 2: no rollup — every distinct error string exactly as returned by the
# API.  Use this when you need the actual offending values: which specific
# emails are malformed, which external IDs failed lookup, etc.
# ---------------------------------------------------------------------------
summarize_raw() {
    local input_file=$1
    local output_file=$2

    awk -F',' '
    NR == 1 { next }
    {
        error = $4
        for (i = 5; i <= NF; i++) error = error "," $i
        gsub(/^[ \t]+|[ \t]+$/, "", error)

        errors[error]++
        if (!(error in seen)) { order[++n] = error; seen[error] = 1 }
    }
    END {
        for (i = 1; i <= n; i++) {
            max_idx = i
            for (j = i + 1; j <= n; j++)
                if (errors[order[j]] > errors[order[max_idx]]) max_idx = j
            tmp = order[i]; order[i] = order[max_idx]; order[max_idx] = tmp
        }
        for (i = 1; i <= n; i++)
            printf "%5d | %s\n", errors[order[i]], order[i]
    }
    ' "$input_file" >> "$output_file"
}

# ---------------------------------------------------------------------------
# batch_failure_metadata <batch_list_xml>
#
# Prints per-batch failure counts pulled from <numberRecordsFailed> in the
# batch list XML, plus a total.  Uses only split() — no gawk match().
# ---------------------------------------------------------------------------
batch_failure_metadata() {
    local xml_file=$1

    awk '
    /<id>/ {
        split($0, parts,  "<id>")
        split(parts[2], parts2, "</id>")
        id = parts2[1]
    }
    /<numberRecordsFailed>/ {
        split($0, parts,  "<numberRecordsFailed>")
        split(parts[2], parts2, "</numberRecordsFailed>")
        failed = parts2[1]
        if (failed + 0 > 0) {
            printf "  Batch %s: %d failed\n", id, failed
            total += failed
        }
    }
    END {
        printf "  ----------------------------------------\n"
        printf "  Total failed records (from metadata): %d\n", total
    }
    ' "$xml_file"
}

# ---------------------------------------------------------------------------
# list_jobs <sf_alias>
# ---------------------------------------------------------------------------
list_jobs() {
    local sf_alias=$1

    echo -e "${GREEN}=== Listing Recent Bulk API Jobs ===${NC}"
    echo ""

    sf org display --target-org "${sf_alias}" --json 2>&1 | grep -v "^›" > /tmp/sf_org_info_raw.json
    sed -n '/{/,$ p' /tmp/sf_org_info_raw.json > /tmp/sf_org_info.json

    local instance_url=$(jq -r '.result.instanceUrl // empty' /tmp/sf_org_info.json)
    local access_token=$(jq -r '.result.accessToken // empty' /tmp/sf_org_info.json)
    local api_version=$(jq -r '.result.apiVersion // "59.0"' /tmp/sf_org_info.json)

    echo "Instance:    ${instance_url}"
    echo "API Version: ${api_version}"
    echo ""

    local jobs_response=$(curl -s \
        -H "Authorization: Bearer ${access_token}" \
        -H "Content-Type: application/json" \
        "${instance_url}/services/data/v${api_version}/jobs/ingest")

    if echo "$jobs_response" | jq -e '.records' > /dev/null 2>&1; then
        local job_count=$(echo "$jobs_response" | jq '.records | length')
        echo -e "${GREEN}Found ${job_count} Bulk API Jobs:${NC}"
        echo "================================================================================================"
        printf "%-20s %-15s %-10s %-12s %-20s %-10s\n" "Job ID" "Object" "Operation" "State" "Created" "API Ver"
        echo "================================================================================================"

        echo "$jobs_response" | jq -r '.records[] | [.id, .object, .operation, .state, (.createdDate | split("T")[0] + " " + (split("T")[1] | split(".")[0])), (.apiVersion // "v1")] | @tsv' | \
        while IFS=$'\t' read -r id object operation state created api_ver; do
            printf "%-20s %-15s %-10s %-12s %-20s %-10s\n" "$id" "$object" "$operation" "$state" "$created" "$api_ver"
        done
        echo "================================================================================================"
        echo ""
        echo "To analyze a job:  $0 <job_id> ${sf_alias}"
    else
        log_error "Failed to retrieve jobs"
        echo "$jobs_response" | jq '.' 2>/dev/null || echo "$jobs_response"
    fi
    exit 0
}

# ---------------------------------------------------------------------------
# analyze_local_files <directory>
# ---------------------------------------------------------------------------
analyze_local_files() {
    local source_dir=$1

    echo -e "${GREEN}=== Analyzing Local Bulk API Result Files ===${NC}"
    echo "Source Directory: ${source_dir}"
    echo ""

    [ ! -d "${source_dir}" ] && { log_error "Directory does not exist: ${source_dir}"; exit 1; }

    local csv_count=$(find "${source_dir}" -name "*.csv" -type f | wc -l)
    [ "$csv_count" -eq 0 ] && { log_error "No CSV files found in ${source_dir}"; exit 1; }

    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    WORK_DIR="bulk_analysis_local_${TIMESTAMP}"
    mkdir -p "${WORK_DIR}"
    cd "${WORK_DIR}"

    log_info "Found ${csv_count} CSV files"
    echo "Id,Success,Created,Error" > all_failures.csv

    local file_num=0
    find "${source_dir}" -name "*.csv" -type f | sort | while IFS= read -r csv_file; do
        file_num=$((file_num + 1))
        log_info "Processing [${file_num}/${csv_count}]: $(basename "${csv_file}")"
        extract_failures "${csv_file}" all_failures.csv
    done

    local failure_count=$(tail -n +2 all_failures.csv | wc -l)
    log_info "Total failures found: ${failure_count}"

    if [ "${failure_count}" -eq 0 ]; then
        echo -e "${GREEN}No failures found!${NC}"
    else
        cat > error_summary.txt <<EOF
Salesforce Bulk API v1 Job Error Summary
=========================================
Job ID:              ${JOB_ID}
Object:              ${OBJECT_NAME}
Operation:           ${OPERATION}
External ID Field:   ${EXTERNAL_ID_FIELD:-N/A}
Records Processed:   ${NUM_RECORDS_PROCESSED}
Records Failed:      ${failure_count}

EOF
        
        echo "=== LEVEL 1: BY ERROR SIGNATURE ===" >> error_summary.txt
        echo "    (code + field + entity; record-specific values stripped)" >> error_summary.txt
        echo "" >> error_summary.txt
        summarize_by_signature all_failures.csv error_summary.txt

        echo "" >> error_summary.txt
        echo "=== LEVEL 2: RAW MESSAGES ===" >> error_summary.txt
        echo "    (every distinct error string, with actual offending values)" >> error_summary.txt
        echo "" >> error_summary.txt
        summarize_raw all_failures.csv error_summary.txt

        cat error_summary.txt
    fi
    exit 0
}

# ---------------------------------------------------------------------------
# Argument dispatch
# ---------------------------------------------------------------------------
if [ "${1:-}" = "--analyze-files" ] && [ $# -eq 2 ]; then
    analyze_local_files "$2"
fi
if [ "${1:-}" = "--list-jobs" ] && [ $# -eq 2 ]; then
    list_jobs "$2"
fi
if [ $# -ne 2 ]; then
    echo -e "${RED}Usage:${NC}"
    echo "  $0 <job_id> <sf_alias>          # Analyze job via API"
    echo "  $0 --list-jobs <sf_alias>       # List recent jobs"
    echo "  $0 --analyze-files <directory>  # Analyze local CSVs"
    exit 1
fi

# ---------------------------------------------------------------------------
# Main — API-based analysis
# ---------------------------------------------------------------------------
JOB_ID=$1
SF_ALIAS=$2
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
WORK_DIR="bulk_job_analysis_${JOB_ID}_${TIMESTAMP}"

echo -e "${GREEN}=== Salesforce Bulk API Job Failure Analyzer ===${NC}"
echo "Job ID:         ${JOB_ID}"
echo "SF Alias:       ${SF_ALIAS}"
echo "Work Directory: ${WORK_DIR}"
echo ""

# Validate Job ID (15 or 18 char, prefix 750)
if [[ ! "${JOB_ID}" =~ ^750[a-zA-Z0-9]{12}$ ]] && [[ ! "${JOB_ID}" =~ ^750[a-zA-Z0-9]{15}$ ]]; then
    log_error "Job ID format invalid: ${JOB_ID} (${#JOB_ID} chars)"
    echo "Expected: 750 + 12 or 15 alphanumeric characters"
    echo "Run:  $0 --list-jobs ${SF_ALIAS}"
    exit 1
fi

mkdir -p "${WORK_DIR}"
cd "${WORK_DIR}"
log_debug "Working directory created: $(pwd)"

# --- Org credentials --------------------------------------------------------
log_info "Getting org information..."
sf org display --target-org "${SF_ALIAS}" --json 2>&1 | grep -v "^›" > sf_org_info_raw.json
sed -n '/{/,$ p' sf_org_info_raw.json > sf_org_info.json

INSTANCE_URL=$(jq -r '.result.instanceUrl // empty' sf_org_info.json)
ACCESS_TOKEN=$(jq -r '.result.accessToken // empty' sf_org_info.json)
USERNAME=$(jq -r '.result.username // empty' sf_org_info.json)
API_VERSION=$(jq -r '.result.apiVersion // "59.0"' sf_org_info.json)

log_info "Instance URL: ${INSTANCE_URL}"
log_info "Username:     ${USERNAME}"
log_info "API Version:  ${API_VERSION}"

[ -z "${INSTANCE_URL}" ] || [ -z "${ACCESS_TOKEN}" ] && { log_error "Could not extract credentials"; exit 1; }

# --- api_call <endpoint> <output_file> [description] ------------------------
api_call() {
    local endpoint=$1
    local output_file=$2
    local description=${3:-"API call"}
    local full_url="${INSTANCE_URL}${endpoint}"

    log_info "${description}"
    log_debug "URL: ${full_url}"

    # Attempt 1: X-SFDC-Session (works for Bulk API v1 in your org)
    log_debug "Attempt 1: X-SFDC-Session header"
    local http_code
    http_code=$(curl -w "%{http_code}" -s \
         -H "X-SFDC-Session: ${ACCESS_TOKEN}" \
         -H "Content-Type: application/xml; charset=UTF-8" \
         -o "${output_file}" \
         "${full_url}")
    log_debug "HTTP Status: ${http_code}"

    # Attempt 2: Bearer fallback
    if [ "${http_code}" -ne 200 ]; then
        log_debug "Attempt 2: Authorization Bearer header"
        http_code=$(curl -w "%{http_code}" -s \
             -H "Authorization: Bearer ${ACCESS_TOKEN}" \
             -H "Content-Type: application/xml; charset=UTF-8" \
             -o "${output_file}" \
             "${full_url}")
        log_debug "HTTP Status: ${http_code}"
    fi

    [ ! -f "${output_file}" ]  && { log_error "Output file not created"; return 1; }

    local file_size
    file_size=$(wc -c < "${output_file}")
    log_debug "Response size: ${file_size} bytes"
    [ "${file_size}" -eq 0 ] && { log_error "Response is empty"; return 1; }

    if grep -q "<exceptionCode>" "${output_file}" 2>/dev/null; then
        log_error "API error:"
        cat "${output_file}" | tee -a "${DEBUG_LOG}"
        return 1
    fi

    [ "${http_code}" -ne 200 ] && { log_error "HTTP ${http_code}"; cat "${output_file}" | tee -a "${DEBUG_LOG}"; return 1; }

    log_success "${description} completed (${file_size} bytes)"
    return 0
}

# --- api_call_v2 <endpoint> <output_file> [description] --------------------
# Bulk API v2 REST calls — Bearer token only, JSON content type.
# Sets V2_LAST_HTTP_CODE so callers can inspect it without a subshell.
# ---------------------------------------------------------------------------
V2_LAST_HTTP_CODE=0
api_call_v2() {
    local endpoint=$1
    local output_file=$2
    local description=${3:-"API call"}
    local full_url="${INSTANCE_URL}${endpoint}"

    log_info "${description}"
    log_debug "URL (v2): ${full_url}"

    V2_LAST_HTTP_CODE=$(curl -w "%{http_code}" -s \
        -H "Authorization: Bearer ${ACCESS_TOKEN}" \
        -H "Content-Type: application/json; charset=UTF-8" \
        -o "${output_file}" \
        "${full_url}")
    log_debug "HTTP Status: ${V2_LAST_HTTP_CODE}"

    [ ! -f "${output_file}" ] && { log_error "Output file not created"; return 1; }

    local file_size
    file_size=$(wc -c < "${output_file}")
    log_debug "Response size: ${file_size} bytes"
    [ "${file_size}" -eq 0 ] && { log_error "Response is empty"; return 1; }

    [ "${V2_LAST_HTTP_CODE}" -ne 200 ] && {
        log_error "HTTP ${V2_LAST_HTTP_CODE}"
        cat "${output_file}" | tee -a "${DEBUG_LOG}"
        return 1
    }

    log_success "${description} completed (${file_size} bytes)"
    return 0
}

# ---------------------------------------------------------------------------
# extract_failures_v2 <input_csv> <output_csv>
#
# Bulk API v2 failedResults CSV schema:
#   sf__Id,sf__Error,<field1>,<field2>,...
# All rows in this file are failures (the endpoint only returns failed records).
# We normalize to the same 4-col output as extract_failures so the shared
# summarizers work unchanged:
#   Id,Success,Created,Error
# (Success and Created are synthetic constants; only Id and Error are needed.)
#
# The error column (col 2) may contain commas inside double-quoted fields.
# We extract it by finding the header index and using proper CSV quoting logic.
# ---------------------------------------------------------------------------
extract_failures_v2() {
    local input_file=$1
    local output_file=$2

    awk -F',' '
    NR == 1 {
        # Locate sf__Id (col 1) and sf__Error (col 2) by header name
        id_col = 0; err_col = 0
        for (i = 1; i <= NF; i++) {
            hdr = $i; gsub(/^"|"$/, "", hdr)
            if (hdr == "sf__Id")    id_col  = i
            if (hdr == "sf__Error") err_col = i
        }
        next
    }
    id_col == 0 || err_col == 0 { next }
    {
        # Extract id
        id = $id_col; gsub(/^"|"$/, "", id)

        # Reassemble error: may span multiple comma-separated fields if it
        # contains commas inside quotes.  Collect from err_col to end, then
        # strip leading/trailing outer quotes from the combined string.
        error = $err_col
        for (i = err_col + 1; i <= NF; i++) error = error "," $i
        gsub(/^"|"$/, "", error)

        print id ",false,," error
    }
    ' "$input_file" >> "$output_file"
}

# ==========================================================================
# Step 1 — Detect API version (v2 REST vs v1 SOAP) and get job details
# ==========================================================================
echo ""
echo -e "${YELLOW}Step 1: Detecting job API version and retrieving details...${NC}"

JOB_API_VERSION="v1"   # default; overridden below if v2 probe succeeds

# Probe v2 REST endpoint first — it is the authoritative source for v2 jobs
# and accepts the OAuth Bearer token at all API versions.
if api_call_v2 "/services/data/v${API_VERSION}/jobs/ingest/${JOB_ID}" \
               "job_details.json" "Probing Bulk API v2 endpoint" 2>/dev/null; then
    JOB_TYPE=$(jq -r '.jobType // empty' job_details.json)
    if [ "${JOB_TYPE}" = "V2Ingest" ]; then
        JOB_API_VERSION="v2"
        log_info "Job is Bulk API v2 (jobType=V2Ingest)"
    fi
fi

if [ "${JOB_API_VERSION}" = "v2" ]; then
    # ---- v2 path: all metadata already in job_details.json ----
    OBJECT_NAME=$(jq -r '.object // empty'                   job_details.json)
    STATE=$(jq -r '.state // empty'                          job_details.json)
    OPERATION=$(jq -r '.operation // empty'                  job_details.json)
    EXTERNAL_ID_FIELD=$(jq -r '.externalIdFieldName // empty' job_details.json)
    CREATED_DATE=$(jq -r '.createdDate // empty'             job_details.json)
    NUM_RECORDS_PROCESSED=$(jq -r '.numberRecordsProcessed // 0' job_details.json)
    NUM_RECORDS_FAILED=$(jq -r '.numberRecordsFailed // 0'   job_details.json)
    NUM_BATCHES_TOTAL="N/A (v2)"
else
    # ---- v1 path: fetch XML job details ----
    api_call "/services/async/${API_VERSION}/job/${JOB_ID}" "job_details.xml" "Fetching job details (v1)" || exit 1

    OBJECT_NAME=$(extract_xml job_details.xml "object")
    STATE=$(extract_xml job_details.xml "state")
    OPERATION=$(extract_xml job_details.xml "operation")
    EXTERNAL_ID_FIELD=$(extract_xml job_details.xml "externalIdFieldName")
    CREATED_DATE=$(extract_xml job_details.xml "createdDate")
    NUM_RECORDS_PROCESSED=$(extract_xml job_details.xml "numberRecordsProcessed")
    NUM_RECORDS_FAILED=$(extract_xml job_details.xml "numberRecordsFailed")
    NUM_BATCHES_TOTAL=$(extract_xml job_details.xml "numberBatchesTotal")
fi

echo ""
log_info "Job Information (API: ${JOB_API_VERSION}):"
echo "  Object:            ${OBJECT_NAME}"
echo "  Operation:         ${OPERATION}"
echo "  State:             ${STATE}"
echo "  Created:           ${CREATED_DATE}"
echo "  Records Processed: ${NUM_RECORDS_PROCESSED}"
echo "  Records Failed:    ${NUM_RECORDS_FAILED}"
echo "  Total Batches:     ${NUM_BATCHES_TOTAL}"
echo ""

# ==========================================================================
# Early skip — degenerate job only (zero records processed).
# The threshold-based skip (>10k failures or >80%) is evaluated at Step 7,
# after failures are extracted, so that we can sample and summarize rather
# than producing no analysis at all.
# ==========================================================================
if [ "${NUM_RECORDS_PROCESSED:-0}" -eq 0 ]; then
    echo -e "${YELLOW}=== SKIP ===${NC}"
    echo -e "${RED}numberRecordsProcessed is 0 — degenerate job, nothing to analyze${NC}"
    echo ""
    cat > REPORT.txt <<EOF
Salesforce Bulk API Job Analysis Report — SKIPPED
==================================================
Generated: $(date)
Reason: numberRecordsProcessed is 0 — degenerate job

Job Details:
  Job ID:             ${JOB_ID}
  API Version:        ${JOB_API_VERSION}
  Object:             ${OBJECT_NAME}
  Operation:          ${OPERATION}
  State:              ${STATE}
  Created:            ${CREATED_DATE}
  Total Batches:      ${NUM_BATCHES_TOTAL}
  Records Processed:  ${NUM_RECORDS_PROCESSED}
  Records Failed:     ${NUM_RECORDS_FAILED}
EOF
    log_success "Report saved to REPORT.txt"
    echo -e "${GREEN}Done. Output in ${WORK_DIR}${NC}"
    exit 0
fi

# ==========================================================================
# Steps 2-6 — Download results and extract failures
#             (fork by API version; Step 7 onwards is shared)
# ==========================================================================

if [ "${JOB_API_VERSION}" = "v2" ]; then

    # ---- v2 path -------------------------------------------------------
    # v2 exposes a single /failedResults endpoint that returns only the
    # failed records as a CSV.  No batch enumeration required.
    # --------------------------------------------------------------------
    echo -e "${YELLOW}Step 2 (v2): Downloading failed results CSV...${NC}"
    successful_downloads=0
    failed_downloads=0
    BATCH_COUNT="N/A (v2)"

    if api_call_v2 "/services/data/v${API_VERSION}/jobs/ingest/${JOB_ID}/failedResults" \
                   "v2_failed_results.csv" "Downloading v2 failedResults"; then
        successful_downloads=1
        log_success "v2 failedResults downloaded"
    else
        failed_downloads=1
        log_error "Failed to download v2 failedResults"
    fi

    echo ""
    [ "${successful_downloads}" -eq 0 ] && { log_error "No results downloaded"; exit 1; }

    echo -e "${YELLOW}Steps 3-4 (v2): Extracting failures from failedResults CSV...${NC}"
    echo "Id,Success,Created,Error" > all_failures.csv
    extract_failures_v2 "v2_failed_results.csv" all_failures.csv

    failure_count=$(tail -n +2 all_failures.csv | wc -l | tr -d ' ')
    echo ""
    log_info "Total failures extracted: ${failure_count}"
    echo ""

else

    # ---- v1 path (original code, unchanged) ----------------------------
    echo -e "${YELLOW}Step 2 (v1): Retrieving batch list...${NC}"
    api_call "/services/async/${API_VERSION}/job/${JOB_ID}/batch" "batch_list.xml" "Fetching batch list" || exit 1

    BATCH_IDS=$(sed -n 's/.*<id>\([^<]*\)<\/id>.*/\1/p' batch_list.xml | grep -v "^${JOB_ID}$" || true)
    [ -z "${BATCH_IDS}" ] && { log_error "No batches found"; exit 1; }

    BATCH_COUNT=$(echo "${BATCH_IDS}" | wc -l | tr -d ' ')
    log_success "Found ${BATCH_COUNT} batches"
    echo ""

    log_info "Batch-level failure summary from metadata:"
    echo "------------------------------------------------"
    batch_failure_metadata batch_list.xml
    echo ""

    echo -e "${YELLOW}Steps 3-4 (v1): Downloading batch results...${NC}"
    mkdir -p batch_results

    batch_num=0
    successful_downloads=0
    failed_downloads=0

    for batch_id in ${BATCH_IDS}; do
        batch_num=$((batch_num + 1))
        log_info "Batch ${batch_num}/${BATCH_COUNT}: ${batch_id}"

        if api_call "/services/async/${API_VERSION}/job/${JOB_ID}/batch/${batch_id}/result" \
                    "batch_results/${batch_id}_result.csv" \
                    "Downloading batch ${batch_id}"; then
            successful_downloads=$((successful_downloads + 1))
        else
            failed_downloads=$((failed_downloads + 1))
            log_error "Failed to download batch ${batch_id}"
        fi
    done

    echo ""
    log_info "Downloads: ${successful_downloads} successful, ${failed_downloads} failed"
    echo ""
    [ "${successful_downloads}" -eq 0 ] && { log_error "No results downloaded"; exit 1; }

    echo -e "${YELLOW}Steps 5-6 (v1): Extracting failures...${NC}"
    echo "Id,Success,Created,Error" > all_failures.csv

    for result_file in batch_results/*_result.csv; do
        [ ! -f "$result_file" ] && continue

        before_count=$(wc -l < all_failures.csv)
        extract_failures "$result_file" all_failures.csv
        after_count=$(wc -l < all_failures.csv)
        added=$((after_count - before_count))

        [ "${added}" -gt 0 ] && log_info "  $(basename "$result_file"): ${added} failures"
    done

    failure_count=$(tail -n +2 all_failures.csv | wc -l | tr -d ' ')
    echo ""
    log_info "Total failures extracted from CSVs: ${failure_count}"
    echo ""

fi

# ==========================================================================
# Step 7 — Error summary
# ==========================================================================
echo -e "${YELLOW}Step 7: Analyzing error patterns...${NC}"

# Thresholds — if either trips, we summarize a sample instead of all rows.
SKIP_THRESHOLD_COUNT=10000
SKIP_THRESHOLD_PCT=80
SAMPLE_SIZE=500

if [ "${failure_count}" -eq 0 ]; then
    echo -e "${GREEN}No failures found in this job!${NC}"
else
    # --- Threshold check using job metadata (already extracted in Step 1) ---
    OVER_THRESHOLD=$(awk -v fail="${failure_count}" \
                        -v proc="${NUM_RECORDS_PROCESSED:-0}" \
                        -v tcount="${SKIP_THRESHOLD_COUNT}" \
                        -v tpct="${SKIP_THRESHOLD_PCT}" 'BEGIN {
        if (proc + 0 == 0) { print 1; exit }
        pct = int((fail / proc) * 100)
        print (fail + 0 > tcount || pct > tpct) ? 1 : 0
    }')

    if [ "${OVER_THRESHOLD}" -eq 1 ]; then
        # ---------------------------------------------------------------
        # SAMPLE PATH — failure volume too large for full per-row analysis.
        # Sample evenly across all_failures.csv (which is batch-sequential,
        # so even spacing spreads across batches naturally), then run both
        # summarizers on the sample.  All output is labeled as sampled.
        # ---------------------------------------------------------------
        TOTAL_ROWS=${failure_count}
        ACTUAL_SAMPLE=${SAMPLE_SIZE}
        [ "${TOTAL_ROWS}" -lt "${SAMPLE_SIZE}" ] && ACTUAL_SAMPLE=${TOTAL_ROWS}

        PCT_FAILED=$(awk -v fail="${failure_count}" -v proc="${NUM_RECORDS_PROCESSED:-1}" \
                        'BEGIN { print int((fail / proc) * 100) }')

        echo -e "${YELLOW}[SAMPLE] ${failure_count} failures (${PCT_FAILED}% of ${NUM_RECORDS_PROCESSED} processed)${NC}"
        echo -e "${YELLOW}         Exceeds thresholds (>${SKIP_THRESHOLD_COUNT} count or >${SKIP_THRESHOLD_PCT}%).${NC}"
        echo -e "${YELLOW}         Summarizing a stratified sample of ${ACTUAL_SAMPLE} rows.${NC}"
        echo ""

        # Evenly-spaced sample: header + every Nth row
        head -1 all_failures.csv > sample_failures.csv
        tail -n +2 all_failures.csv | awk -v total="${TOTAL_ROWS}" -v want="${ACTUAL_SAMPLE}" '
        BEGIN {
            stride = (total > want) ? total / want : 1
            next_sample = stride
            emitted = 0
        }
        {
            if (NR >= next_sample && emitted < want) {
                print
                emitted++
                next_sample += stride
            }
        }
        ' >> sample_failures.csv

        SAMPLED_ROWS=$(( $(wc -l < sample_failures.csv) - 1 ))
        log_info "Sampled ${SAMPLED_ROWS} rows from ${TOTAL_ROWS} total failures"
        echo ""

        # Run summarizers on the sample
        cat > error_summary.txt <<EOF
Salesforce Bulk API v1 Job Error Summary
=========================================
Job ID:              ${JOB_ID}
Object:              ${OBJECT_NAME}
Operation:           ${OPERATION}
External ID Field:   ${EXTERNAL_ID_FIELD:-N/A}
Records Processed:   ${NUM_RECORDS_PROCESSED}
Records Failed:      ${failure_count}

ANALYSIS MODE:       SAMPLED (${SAMPLED_ROWS} of ${TOTAL_ROWS} failures analyzed)
                     Job exceeds thresholds (>${SKIP_THRESHOLD_COUNT} count or >${SKIP_THRESHOLD_PCT}%)

EOF
        
        echo "=== LEVEL 1: BY ERROR SIGNATURE (SAMPLE: ${SAMPLED_ROWS} of ${TOTAL_ROWS} rows) ===" >> error_summary.txt
        echo "    (code + field + entity; record-specific values stripped)" >> error_summary.txt
        echo "" >> error_summary.txt
        summarize_by_signature sample_failures.csv error_summary.txt

        echo "" >> error_summary.txt
        echo "=== LEVEL 2: RAW MESSAGES (SAMPLE: ${SAMPLED_ROWS} of ${TOTAL_ROWS} rows) ===" >> error_summary.txt
        echo "    (every distinct error string, with actual offending values)" >> error_summary.txt
        echo "" >> error_summary.txt
        summarize_raw sample_failures.csv error_summary.txt

        cat error_summary.txt
        echo ""

        unique_signatures=$(sed -n '/LEVEL 1/,/LEVEL 2/p' error_summary.txt | grep -c "|" || echo 0)
        unique_raw=$(sed -n '/LEVEL 2/,$p' error_summary.txt | grep -c "|" || echo 0)

        echo -e "${GREEN}=== ANALYSIS COMPLETE (SAMPLED) ===${NC}"
        echo "Total Failures:          ${failure_count}"
        echo "Sample Size:             ${SAMPLED_ROWS}"
        echo "Unique Signatures:       ${unique_signatures}  (in sample)"
        echo "Unique Raw Messages:     ${unique_raw}  (in sample)"
        echo ""
        echo "Output files:"
        echo "  sample_failures.csv  — ${SAMPLED_ROWS} sampled failure records"
        echo "  all_failures.csv     — all ${failure_count} failure records (full)"
        echo "  error_summary.txt    — signature + raw rollup (from sample)"
        echo "  batch_results/       — all ${BATCH_COUNT} individual batch CSVs"
        echo "  job_details.xml      — job metadata"

    else
        # ---------------------------------------------------------------
        # FULL PATH — failure count is within thresholds.  Run both
        # summarizers on all_failures.csv directly.
        # ---------------------------------------------------------------
        cat > error_summary.txt <<EOF
Salesforce Bulk API v1 Job Error Summary
=========================================
Job ID:              ${JOB_ID}
Object:              ${OBJECT_NAME}
Operation:           ${OPERATION}
External ID Field:   ${EXTERNAL_ID_FIELD:-N/A}
Records Processed:   ${NUM_RECORDS_PROCESSED}
Records Failed:      ${failure_count}

ANALYSIS MODE:       FULL (all failures analyzed)

EOF
        
        echo "=== LEVEL 1: BY ERROR SIGNATURE ===" >> error_summary.txt
        echo "    (code + field + entity; record-specific values stripped)" >> error_summary.txt
        echo "" >> error_summary.txt
        summarize_by_signature all_failures.csv error_summary.txt

        echo "" >> error_summary.txt
        echo "=== LEVEL 2: RAW MESSAGES ===" >> error_summary.txt
        echo "    (every distinct error string, with actual offending values)" >> error_summary.txt
        echo "" >> error_summary.txt
        summarize_raw all_failures.csv error_summary.txt

        cat error_summary.txt
        echo ""

        unique_signatures=$(sed -n '/LEVEL 1/,/LEVEL 2/p' error_summary.txt | grep -c "|" || echo 0)
        unique_raw=$(sed -n '/LEVEL 2/,$p' error_summary.txt | grep -c "|" || echo 0)

        echo -e "${GREEN}=== ANALYSIS COMPLETE ===${NC}"
        echo "Total Failures:          ${failure_count}"
        echo "Unique Error Signatures: ${unique_signatures}"
        echo "Unique Raw Messages:     ${unique_raw}"
        echo ""
        echo "Output files:"
        echo "  all_failures.csv   — ${failure_count} failure records"
        echo "  error_summary.txt  — two-level error rollup"
        echo "  batch_results/     — all ${BATCH_COUNT} individual batch CSVs"
        echo "  batch_list.xml     — batch metadata (per-batch fail counts)"
        echo "  job_details.xml    — job metadata"
    fi
fi

# ==========================================================================
# Final report
# ==========================================================================
unique_signatures=$(sed -n '/LEVEL 1/,/LEVEL 2/p' error_summary.txt 2>/dev/null | grep -c "|" || echo 0)
unique_raw=$(sed -n '/LEVEL 2/,$p' error_summary.txt 2>/dev/null | grep -c "|" || echo 0)

# Determine whether Step 7 ran in sample mode or full mode
if [ -f sample_failures.csv ]; then
    SAMPLED_ROWS=$(( $(wc -l < sample_failures.csv) - 1 ))
    ANALYSIS_NOTE="SAMPLED — signature/raw counts are from a ${SAMPLED_ROWS}-row sample"
    SAMPLE_FILE_LINE="  sample_failures.csv — ${SAMPLED_ROWS} evenly-sampled failure records"
else
    ANALYSIS_NOTE="FULL — all failure records analyzed"
    SAMPLE_FILE_LINE=""
fi

if [ "${JOB_API_VERSION}" = "v2" ]; then
    RESULTS_FILE_LINE="  v2_failed_results.csv — raw v2 failedResults download"
else
    RESULTS_FILE_LINE="  batch_results/        — all ${BATCH_COUNT} individual batch CSVs"
fi

cat > REPORT.txt <<EOF
Salesforce Bulk API Job Analysis Report
========================================
Generated: $(date)
API:       ${JOB_API_VERSION}
Analysis:  ${ANALYSIS_NOTE}

Job Details:
  Job ID:             ${JOB_ID}
  Object:             ${OBJECT_NAME}
  Operation:          ${OPERATION}
  State:              ${STATE}
  Created:            ${CREATED_DATE}
  Total Batches:      ${NUM_BATCHES_TOTAL}
  Records Processed:  ${NUM_RECORDS_PROCESSED}
  Records Failed:     ${NUM_RECORDS_FAILED}

Results:
  Total Failures:          ${failure_count}
  Unique Error Signatures: ${unique_signatures}  (code + field + entity)
  Unique Raw Messages:     ${unique_raw}         (every distinct string)
  Batch Downloads:         ${successful_downloads} ok / ${failed_downloads} failed

Output Files:
  error_summary.txt  — two-level ranked error rollup
  all_failures.csv   — full failure records (${failure_count} rows)
${SAMPLE_FILE_LINE}
${RESULTS_FILE_LINE}
  debug.log          — execution log
EOF

echo ""
log_success "Report saved to REPORT.txt"
log_success "Debug log saved to debug.log"
echo ""
echo -e "${GREEN}Done. Output in ${WORK_DIR}${NC}"
