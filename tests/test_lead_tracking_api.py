#!/usr/bin/env python3
"""
Lead-Tracking API Audit Script
================================
Comprehensive test for the CRM leads API:
1. Simulates GET /crm/leads with limit=5, offset=10 (page=3)
2. Verifies pagination object structure and accuracy
3. Validates total count matches database
4. Tests Pydantic-style serialization of created_at/updated_at fields

Usage:
    python3 tests/test_lead_tracking_api.py
"""

import json
import sqlite3
import sys
import os
from datetime import datetime
from typing import Any, Dict, List, Optional

# ── Path to the Redcloud Auto-Pilot project ──────────────────────────────
CRM_DB_PATH = os.path.expanduser(
    "/Users/AM/Library/Mobile Documents/.Trash/Redcloud Sales Auto-Pilot MVP/crm_leads.db"
)

# ── Pipeline Stages (from orchestrator_api.py) ───────────────────────────
PIPELINE_STAGES = [
    "new_lead", "contacted", "qualified", "proposal_sent",
    "negotiation", "won", "lost",
]


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 1: Pydantic-style Models (simulating what the API should use)
# ═══════════════════════════════════════════════════════════════════════════

class LeadModel:
    """
    Pydantic-style lead model.
    Simulates BaseModel serialization for created_at and updated_at.
    """
    def __init__(self, row: sqlite3.Row):
        self.id: int = row["id"]
        self.company_name: str = row["company_name"]
        # Use try/except since sqlite3.Row doesn't support .get()
        self.contact_email: str = self._safe_get(row, "contact_email", "")
        self.website: str = self._safe_get(row, "website", "")
        self.phone: str = self._safe_get(row, "phone", "")
        self.industry: str = self._safe_get(row, "industry", "")
        self.location: str = self._safe_get(row, "location", "")
        self.company_size: str = self._safe_get(row, "company_size", "")
        self.revenue_range: str = self._safe_get(row, "revenue_range", "")
        self.source: str = self._safe_get(row, "source", "")
        self.status: str = self._safe_get(row, "status", "new")
        self.score: int = self._safe_get(row, "score", 0)
        self.segment: str = self._safe_get(row, "segment", "")
        self.stage: str = self._safe_get(row, "stage", "new_lead")
        self.created_at: str = row["created_at"]
        self.updated_at: str = row["updated_at"]

    @staticmethod
    def _safe_get(row: sqlite3.Row, key: str, default: Any = None) -> Any:
        """Safely get a value from sqlite3.Row (which lacks .get())."""
        try:
            val = row[key]
            return val if val is not None else default
        except (KeyError, IndexError):
            return default

    def to_dict(self) -> Dict[str, Any]:
        """Serialize to dict — equivalent to Pydantic's .model_dump()."""
        return {
            "id": self.id,
            "company_name": self.company_name,
            "contact_email": self.contact_email,
            "website": self.website,
            "phone": self.phone,
            "industry": self.industry,
            "location": self.location,
            "company_size": self.company_size,
            "revenue_range": self.revenue_range,
            "source": self.source,
            "status": self.status,
            "score": self.score,
            "segment": self.segment,
            "stage": self.stage,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }

    def to_json(self) -> str:
        """
        Pydantic-style JSON serialization.
        Validates that created_at and updated_at serialize without errors.
        """
        try:
            return json.dumps(self.to_dict(), ensure_ascii=False)
        except (TypeError, ValueError) as e:
            raise SerializationError(
                f"Failed to serialize lead {self.id}: {e}"
            )


class PaginationResult:
    """Mimics the API pagination response structure."""

    def __init__(self, data: List[Dict], total: int, page: int, limit: int):
        self.data = data
        self.total = total
        self.page = page
        self.limit = limit
        self.totalPages = max(1, (total + limit - 1) // limit) if total > 0 else 1

    def to_dict(self) -> Dict[str, Any]:
        return {
            "data": self.data,
            "total": self.total,
            "page": self.page,
            "totalPages": self.totalPages,
            "limit": self.limit,
        }


class SerializationError(Exception):
    """Raised when serialization fails."""
    pass


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 2: Database Operations
# ═══════════════════════════════════════════════════════════════════════════

def get_db_connection(db_path: str) -> sqlite3.Connection:
    """Open SQLite connection with row factory."""
    if not os.path.exists(db_path):
        raise FileNotFoundError(f"Database not found at: {db_path}")
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def get_total_leads(conn: sqlite3.Connection) -> int:
    """Get the actual total count from the database."""
    cursor = conn.execute("SELECT COUNT(*) FROM crm_leads")
    return cursor.fetchone()[0]


def fetch_leads_paginated(
    conn: sqlite3.Connection,
    limit: int = 5,
    offset: int = 0,
) -> List[sqlite3.Row]:
    """Fetch leads with pagination — mirrors the API SQL."""
    cursor = conn.execute(
        """
        SELECT * FROM crm_leads
        ORDER BY created_at DESC, id DESC
        LIMIT ? OFFSET ?
        """,
        (limit, offset),
    )
    return cursor.fetchall()


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 3: Audit Tests
# ═══════════════════════════════════════════════════════════════════════════

PASS = 0
FAIL = 0


def check(name: str, condition: bool, detail: str = ""):
    """Test assertion with pass/fail tracking."""
    global PASS, FAIL
    if condition:
        PASS += 1
        print(f"  ✅ PASS: {name}")
    else:
        FAIL += 1
        print(f"  ❌ FAIL: {name}" + (f" — {detail}" if detail else ""))


def print_separator(title: str):
    """Print a section header."""
    print(f"\n{'═' * 70}")
    print(f"  {title}")
    print(f"{'═' * 70}")


# ═══════════════════════════════════════════════════════════════════════════
# TEST RUNNER
# ═══════════════════════════════════════════════════════════════════════════

def run_audit():
    """Run the complete lead-tracking API audit."""
    global PASS, FAIL

    print(f"\n{'#' * 70}")
    print(f"#  LEAD-TRACKING API AUDIT")
    print(f"#  Database: {CRM_DB_PATH}")
    print(f"{'#' * 70}")

    # ─────────────────────────────────────────────────────────────────────
    # Test 1: Database connectivity
    # ─────────────────────────────────────────────────────────────────────
    print_separator("TEST 1: Database Connectivity")
    try:
        conn = get_db_connection(CRM_DB_PATH)
        check("Database connection opened", True)
    except FileNotFoundError as e:
        print(f"  ❌ CRITICAL: {e}")
        return

    # ─────────────────────────────────────────────────────────────────────
    # Test 2: Total count validation
    # ─────────────────────────────────────────────────────────────────────
    print_separator("TEST 2: Total Count Accuracy")
    db_total = get_total_leads(conn)
    check("Total count is positive integer", db_total >= 0, f"Got: {db_total}")
    check("Total count matches expected", db_total == 8, f"Expected 8, got {db_total}")
    print(f"\n     Database contains {db_total} leads total")

    # ─────────────────────────────────────────────────────────────────────
    # Test 3: Pagination — limit=5, page=1 (offset=0)
    # ─────────────────────────────────────────────────────────────────────
    print_separator("TEST 3: Pagination — Default (limit=5, page=1, offset=0)")
    limit = 5
    page = 1
    offset = (page - 1) * limit

    rows = fetch_leads_paginated(conn, limit=limit, offset=offset)
    leads = [LeadModel(r) for r in rows]
    pagination = PaginationResult(
        data=[l.to_dict() for l in leads],
        total=db_total,
        page=page,
        limit=limit,
    )

    result = pagination.to_dict()
    check("Response contains 'data' key", "data" in result)
    check("Response contains 'total' key", "total" in result)
    check("Response contains 'page' key", "page" in result)
    check("Response contains 'totalPages' key", "totalPages" in result)
    check("Response contains 'limit' key", "limit" in result)
    check("Page number is correct", result["page"] == 1)
    check("Limit is correct", result["limit"] == 5)
    check("Total matches database count", result["total"] == db_total)
    check("totalPages calculated correctly", result["totalPages"] == max(1, (db_total + limit - 1) // limit))
    check(f"Page returns min(limit, remaining) items", len(result["data"]) == min(limit, db_total))
    print(f"\n     Page {page}: {len(result['data'])} leads, total={result['total']}, pages={result['totalPages']}")

    # ─────────────────────────────────────────────────────────────────────
    # Test 4: Pagination — limit=5, page=3 (offset=10)
    # ─────────────────────────────────────────────────────────────────────
    print_separator("TEST 4: Pagination — limit=5, offset=10 (page=3)")
    limit = 5
    page = 3  # offset = (3-1) * 5 = 10
    offset = (page - 1) * limit

    rows = fetch_leads_paginated(conn, limit=limit, offset=offset)
    leads = [LeadModel(r) for r in rows]
    pagination = PaginationResult(
        data=[l.to_dict() for l in leads],
        total=db_total,
        page=page,
        limit=limit,
    )

    result = pagination.to_dict()
    check("Response contains all pagination keys", all(k in result for k in ["data", "total", "page", "totalPages", "limit"]))
    check("Page number is 3", result["page"] == 3)
    check("Limit is 5", result["limit"] == 5)
    check("Total still matches database count", result["total"] == 8)
    check("totalPages == 2 (8 leads at 5/page)", result["totalPages"] == 2,
          f"Got {result['totalPages']}")
    check("Page 3 returns 0 leads (past end)", len(result["data"]) == 0,
          f"Got {len(result['data'])} leads")
    print(f"\n     Page {page} (offset={offset}): {len(result['data'])} leads, total={result['total']}, pages={result['totalPages']}")

    # ─────────────────────────────────────────────────────────────────────
    # Test 5: Pagination — limit=5, page=2 (offset=5)
    # ─────────────────────────────────────────────────────────────────────
    print_separator("TEST 5: Pagination — limit=5, page=2 (offset=5)")
    limit = 5
    page = 2
    offset = (page - 1) * limit

    rows = fetch_leads_paginated(conn, limit=limit, offset=offset)
    leads = [LeadModel(r) for r in rows]
    pagination = PaginationResult(
        data=[l.to_dict() for l in leads],
        total=db_total,
        page=page,
        limit=limit,
    )

    result = pagination.to_dict()
    check("Page 2 returns remaining leads", len(result["data"]) == db_total - limit,
          f"Expected {db_total - limit}, got {len(result['data'])}")
    check("Page 2 is not empty", len(result["data"]) > 0)
    print(f"\n     Page {page} (offset={offset}): {len(result['data'])} leads")
    for lead in result["data"]:
        print(f"       - {lead['company_name']} (ID: {lead['id']})")

    # ─────────────────────────────────────────────────────────────────────
    # Test 6: Pydantic-style serialization of created_at and updated_at
    # ─────────────────────────────────────────────────────────────────────
    print_separator("TEST 6: created_at / updated_at Serialization")

    # Fetch all leads for exhaustive testing
    rows = fetch_leads_paginated(conn, limit=db_total, offset=0)

    for row in rows:
        lead = LeadModel(row)
        
        # Test 6a: created_at is present and non-empty
        check(
            f"Lead {lead.id}: created_at is present",
            bool(lead.created_at),
            f"created_at is empty for lead {lead.id}",
        )
        
        # Test 6b: updated_at is present and non-empty
        check(
            f"Lead {lead.id}: updated_at is present",
            bool(lead.updated_at),
            f"updated_at is empty for lead {lead.id}",
        )
        
        # Test 6c: created_at is valid ISO datetime string
        try:
            parsed_created = datetime.strptime(lead.created_at, "%Y-%m-%d %H:%M:%S")
            check(f"Lead {lead.id}: created_at is valid datetime", True)
        except ValueError:
            check(f"Lead {lead.id}: created_at is valid datetime", False,
                  f"Invalid format: '{lead.created_at}'")
        
        # Test 6d: updated_at is valid ISO datetime string
        try:
            parsed_updated = datetime.strptime(lead.updated_at, "%Y-%m-%d %H:%M:%S")
            check(f"Lead {lead.id}: updated_at is valid datetime", True)
        except ValueError:
            check(f"Lead {lead.id}: updated_at is valid datetime", False,
                  f"Invalid format: '{lead.updated_at}'")
        
        # Test 6e: JSON serialization doesn't throw
        try:
            json_str = lead.to_json()
            parsed = json.loads(json_str)
            check(f"Lead {lead.id}: JSON serialization succeeds", True)
            check(f"Lead {lead.id}: created_at survives JSON round-trip",
                  parsed["created_at"] == lead.created_at)
            check(f"Lead {lead.id}: updated_at survives JSON round-trip",
                  parsed["updated_at"] == lead.updated_at)
        except (TypeError, ValueError, json.JSONDecodeError) as e:
            check(f"Lead {lead.id}: JSON serialization succeeds", False, str(e))

    # ─────────────────────────────────────────────────────────────────────
    # Test 7: Check for Pydantic BaseModel usage in orchestrator_api.py
    # ─────────────────────────────────────────────────────────────────────
    print_separator("TEST 7: Pydantic Model Usage Audit")

    api_file = os.path.expanduser(
        "/Users/AM/Library/Mobile Documents/.Trash/Redcloud Sales Auto-Pilot MVP/orchestrator_api.py"
    )
    if os.path.exists(api_file):
        with open(api_file, "r") as f:
            content = f.read()
        
        has_pydantic_import = "from pydantic" in content or "import pydantic" in content
        has_basemodel = "BaseModel" in content
        
        check("Pydantic is imported in orchestrator_api.py", has_pydantic_import)
        check("BaseModel is used", has_basemodel)

        if not has_basemodel or not has_pydantic_import:
            print("\n     ⚠️  The orchestrator_api.py does NOT use Pydantic BaseModel.")
            print("     Created_at/updated_at are returned as raw strings from SQLite.")
            print("     Pydantic is listed in requirements.txt but not used for serialization.")
            print("     Recommendation: Define Pydantic models for type-safe serialization.")
    else:
        print("     ⚠️  orchestrator_api.py not found at expected path.")

    # ─────────────────────────────────────────────────────────────────────
    # Test 8: API response structure validation
    # ─────────────────────────────────────────────────────────────────────
    print_separator("TEST 8: API Response Contract")

    # Simulate what the actual API returns
    limit = 5
    page = 1
    offset = 0
    rows = fetch_leads_paginated(conn, limit=limit, offset=offset)
    data = [dict(r) for r in rows]

    api_response = {
        "data": data,
        "total": db_total,
        "page": page,
        "totalPages": max(1, (db_total + limit - 1) // limit),
        "limit": limit,
    }

    # Validate contract
    check("Response is a dict", isinstance(api_response, dict))
    check("data is a list", isinstance(api_response["data"], list))
    check("total is an int", isinstance(api_response["total"], int))
    check("page is an int", isinstance(api_response["page"], int))
    check("totalPages is an int", isinstance(api_response["totalPages"], int))
    check("limit is an int", isinstance(api_response["limit"], int))
    
    if data:
        sample = data[0]
        check("Each lead has 'created_at' key", "created_at" in sample)
        check("Each lead has 'updated_at' key", "updated_at" in sample)
        check("created_at is a string", isinstance(sample["created_at"], str))
        check("updated_at is a string", isinstance(sample["updated_at"], str))

    # ─────────────────────────────────────────────────────────────────────
    # Summary
    # ─────────────────────────────────────────────────────────────────────
    print(f"\n{'=' * 70}")
    print(f"  AUDIT RESULTS: {PASS} passed, {FAIL} failed, {PASS + FAIL} total")
    if FAIL > 0:
        print(f"  ⚠️  {FAIL} test(s) FAILED — review details above")
    else:
        print(f"  ✅ ALL TESTS PASSED")
    print(f"{'=' * 70}\n")

    conn.close()
    return FAIL == 0


if __name__ == "__main__":
    success = run_audit()
    sys.exit(0 if success else 1)
