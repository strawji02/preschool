# Project: 식자재 단가 감사 시스템 (Food Audit SaaS)

## 1. Project Goal

개발자(Claude)는 아래 제공된 **데이터 Context**와 **요구사항**을 분석하여,
식자재 거래명세서의 단가를 자동으로 감사(Audit)하는 `/calc-food` 페이지를
구축한다.

## 2. Resources (Master Data Context)

우리는 두 가지 공급사의 단가표를 가지고 있다. 개발자는 이 데이터의 특성을
파악하여 최적의 DB Schema를 스스로 설계해야 한다.

### A. CJ Freshway Data Structure

- Key Columns: `상품코드`, `상품명`, `단가` (Standard Price), `판매단가`,
  `과/면세`
- Note: Includes discount rates (`적용률`) and specific conditions (`온도조건`).

### B. Shinsegae Food Data Structure

- Key Columns: `코드`, `품목명`, `결정단가` (Standard Price), `규격`, `원산지`
- Note: Different column names compared to CJ (e.g., `결정단가` vs `단가`).

## 3. Product Requirement Document (PRD)

### Phase 1: Upload & Extraction

- User creates a new Audit Session by uploading PDF invoices (Multiple files
  supported).
- Backend must process the invoice using Gemini Vision API.
- **Extraction Targets:** Item Name, Spec, Quantity, Billed Price.

### Phase 2: Intelligent Matching & DB Design

- **Core Challenge:** The item names in the invoices (OCR) will NOT match the
  Master Data exactly (e.g., "옛날당면" vs "오뚜기\_옛날당면").
- **Developer Task:**
  1. Design a Database Schema (Supabase) that effectively stores products from
     both CJ and Shinsegae. You decide whether to merge them into one table or
     keep them separate.
  2. Implement a "Fuzzy Matching" mechanism (e.g., pg_trgm) to suggest the best
     match from the Master DB.

### Phase 3: The Audit Interface (Split View)

- Build a UI at `/calc-food` with two panels:
  - **Left:** PDF Viewer (showing the receipt).
  - **Right:** Interactive Data Grid.
- **Logic:**
  - `Loss` = `(Invoice Price - Master DB Price) * Quantity`
  - If Loss > 0, highlight the row in Red.
  - Allow users to manually search and correct the mapped Master Product.

## 4. Technical Stack Constraints

- **Framework:** Next.js (App Router)
- **Database:** Supabase (PostgreSQL) - **Design the schema yourself.**
- **AI:** Google Gemini 2.5 Flash
- **Styling:** Tailwind CSS v4 (Use CSS variables, No `tailwind.config.js`)

## 5. Development Instructions (For Claude)

1.  **Analyze & Design:** First, create a `seed.ts` script. In this script,
    define the DB Schema structure you think is best, and populate it with
    sample data representing the CJ and Shinsegae files described above.
2.  **Implementation:** Build the Full-Stack feature (`/api/upload`,
    `/calc-food` page) based on your design.

## 6. Phase 2 Update: API & Architecture Strategy (Vercel Optimized)

**CRITICAL CONSTRAINT:**
This system is deployed on Vercel Free Tier (Serverless Function Timeout: 10s).
Therefore, **the Backend MUST NOT try to process a multi-page PDF in a single request.**

### 1. Architecture: Frontend-Driven Loop

- **Frontend Responsibility:**
  - Loads the PDF.
  - Renders PDF to Images (one image per page).
  - Sends requests to Backend **sequentially** (Page 1 -> Page 2 -> ...).
- **Backend Responsibility:**
  - Statelessly processes **ONE single page image** per request.
  - Returns the analysis result immediately.

### 2. API Endpoints (To be implemented)

#### A. `POST /api/session/init`

- **Purpose:** Start a new audit session.
- **Body:** `{ "supplier": "CJ" | "SHINSEGAE", "total_pages": 5, ... }`
- **Action:** Create a record in `audit_sessions` table.
- **Response:** `{ "session_id": "uuid..." }`

#### B. `POST /api/analyze/page` (The Worker)

- **Purpose:** Analyze a single page image.
- **Body:**
  - `session_id`: UUID
  - `page_number`: Integer
  - `image`: Base64 string (Single Page Image)
- **Process:**
  1. **Upload:** Save the image to Supabase Storage (`/sessions/{id}/{page}.jpg`).
  2. **OCR (Gemini):** Send image to Gemini 2.5 Flash with prompt: "Extract item list as JSON".
  3. **Match (DB):** Query `products` table using `pg_trgm` (Similarity > 0.3).
     - Save Top 5 candidates for manual review if similarity is between 0.3 and 0.8.
  4. **Save:** Insert results into `audit_items` table.
- **Response:** JSON `{ "items": [...], "success": true }`
