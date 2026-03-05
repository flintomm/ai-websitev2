#!/usr/bin/env python3
"""
JAMF Pro Documentation RAG Ingestion Pipeline
Extracts, normalizes, chunks, and indexes PDF documentation.
"""

import json
import hashlib
import re
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Any
import sys

# Paths
BASE_DIR = Path("/Users/flint/Documents/AI Website/.data/jamf-pro-docs")
RAW_DIR = BASE_DIR / "raw"
NORMALIZED_DIR = BASE_DIR / "normalized"
CHUNKS_DIR = BASE_DIR / "chunks"
INDEX_DIR = BASE_DIR / "index"
MANIFESTS_DIR = BASE_DIR / "manifests"

def ensure_dirs():
    for d in [NORMALIZED_DIR, CHUNKS_DIR, INDEX_DIR, MANIFESTS_DIR]:
        d.mkdir(parents=True, exist_ok=True)

def extract_pdf_text(pdf_path: Path) -> str:
    """Extract text from PDF using pdfplumber or PyPDF2."""
    try:
        import pdfplumber
        text_parts = []
        with pdfplumber.open(pdf_path) as pdf:
            for i, page in enumerate(pdf.pages):
                text = page.extract_text()
                if text:
                    text_parts.append(f"\n--- Page {i+1} ---\n{text}")
        return "\n".join(text_parts)
    except ImportError:
        print("pdfplumber not installed, trying PyPDF2...")
        try:
            import PyPDF2
            text_parts = []
            with open(pdf_path, 'rb') as f:
                reader = PyPDF2.PdfReader(f)
                for i, page in enumerate(reader.pages):
                    text = page.extract_text()
                    if text:
                        text_parts.append(f"\n--- Page {i+1} ---\n{text}")
            return "\n".join(text_parts)
        except ImportError:
            raise ImportError("Please install pdfplumber or PyPDF2: pip install pdfplumber")

def normalize_text(raw_text: str, source: str) -> Dict[str, Any]:
    """Clean and structure the extracted text."""
    # Remove excessive whitespace
    text = re.sub(r'\n{3,}', '\n\n', raw_text)
    # Remove page markers for cleaner text but keep structure
    text = re.sub(r'--- Page \d+ ---', '', text)
    # Clean up
    text = text.strip()
    
    return {
        "source": source,
        "extracted_at": datetime.now().isoformat(),
        "text": text,
        "char_count": len(text),
        "line_count": len(text.split('\n'))
    }

def chunk_text(normalized: Dict[str, Any], chunk_size: int = 1000, overlap: int = 200) -> List[Dict[str, Any]]:
    """Split text into overlapping chunks with metadata."""
    text = normalized["text"]
    chunks = []
    
    # Simple paragraph-aware chunking
    paragraphs = [p.strip() for p in text.split('\n\n') if p.strip()]
    current_chunk = []
    current_size = 0
    chunk_num = 0
    
    for para in paragraphs:
        para_size = len(para)
        
        if current_size + para_size > chunk_size and current_chunk:
            # Save current chunk
            chunk_text = '\n\n'.join(current_chunk)
            chunk_id = hashlib.md5(f"{normalized['source']}:{chunk_num}".encode()).hexdigest()[:12]
            chunks.append({
                "id": chunk_id,
                "chunk_num": chunk_num,
                "source": normalized["source"],
                "text": chunk_text,
                "char_count": len(chunk_text),
                "created_at": datetime.now().isoformat()
            })
            chunk_num += 1
            
            # Start new chunk with overlap
            overlap_text = '\n\n'.join(current_chunk[-2:]) if len(current_chunk) >= 2 else current_chunk[-1] if current_chunk else ""
            current_chunk = [overlap_text, para] if overlap_text else [para]
            current_size = len(overlap_text) + para_size if overlap_text else para_size
        else:
            current_chunk.append(para)
            current_size += para_size
    
    # Don't forget the last chunk
    if current_chunk:
        chunk_text = '\n\n'.join(current_chunk)
        chunk_id = hashlib.md5(f"{normalized['source']}:{chunk_num}".encode()).hexdigest()[:12]
        chunks.append({
            "id": chunk_id,
            "chunk_num": chunk_num,
            "source": normalized["source"],
            "text": chunk_text,
            "char_count": len(chunk_text),
            "created_at": datetime.now().isoformat()
        })
    
    return chunks

def build_index(chunks: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Build a simple keyword-based index for retrieval."""
    index = {
        "created_at": datetime.now().isoformat(),
        "chunk_count": len(chunks),
        "sources": list(set(c["source"] for c in chunks)),
        "keyword_index": {},
        "chunks": {c["id"]: {"text": c["text"][:200] + "...", "source": c["source"]} for c in chunks}
    }
    
    # Build inverted index
    for chunk in chunks:
        words = set(re.findall(r'\b[a-zA-Z]{3,}\b', chunk["text"].lower()))
        for word in words:
            if word not in index["keyword_index"]:
                index["keyword_index"][word] = []
            index["keyword_index"][word].append(chunk["id"])
    
    return index

def search_index(query: str, index: Dict[str, Any], top_k: int = 5) -> List[Dict[str, Any]]:
    """Simple keyword search on the index."""
    query_words = set(re.findall(r'\b[a-zA-Z]{3,}\b', query.lower()))
    
    scores = {}
    for word in query_words:
        if word in index.get("keyword_index", {}):
            for chunk_id in index["keyword_index"][word]:
                scores[chunk_id] = scores.get(chunk_id, 0) + 1
    
    # Sort by score
    sorted_chunks = sorted(scores.items(), key=lambda x: x[1], reverse=True)
    
    results = []
    for chunk_id, score in sorted_chunks[:top_k]:
        chunk_info = index["chunks"].get(chunk_id, {})
        results.append({
            "id": chunk_id,
            "score": score,
            "preview": chunk_info.get("text", ""),
            "source": chunk_info.get("source", "")
        })
    
    return results

def ingest_pdf(pdf_path: Path) -> Dict[str, Any]:
    """Full ingestion pipeline for a single PDF."""
    print(f"📄 Ingesting: {pdf_path.name}")
    
    # 1. Extract
    print("  → Extracting text...")
    raw_text = extract_pdf_text(pdf_path)
    
    # 2. Normalize
    print("  → Normalizing...")
    normalized = normalize_text(raw_text, pdf_path.name)
    norm_path = NORMALIZED_DIR / f"{pdf_path.stem}.json"
    norm_path.write_text(json.dumps(normalized, indent=2))
    print(f"    Saved: {norm_path}")
    
    # 3. Chunk
    print("  → Chunking...")
    chunks = chunk_text(normalized)
    chunks_path = CHUNKS_DIR / f"{pdf_path.stem}_chunks.json"
    chunks_path.write_text(json.dumps(chunks, indent=2))
    print(f"    Created {len(chunks)} chunks → {chunks_path}")
    
    # 4. Build index
    print("  → Building index...")
    index = build_index(chunks)
    index_path = INDEX_DIR / f"{pdf_path.stem}_index.json"
    index_path.write_text(json.dumps(index, indent=2))
    print(f"    Saved index: {index_path}")
    
    # 5. Manifest
    manifest = {
        "source": pdf_path.name,
        "ingested_at": datetime.now().isoformat(),
        "normalized": str(norm_path),
        "chunks": str(chunks_path),
        "index": str(index_path),
        "chunk_count": len(chunks)
    }
    manifest_path = MANIFESTS_DIR / f"{pdf_path.stem}_manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2))
    
    print(f"✓ Done: {len(chunks)} chunks indexed")
    return manifest

def main():
    ensure_dirs()
    
    # Find all PDFs in raw/
    pdfs = list(RAW_DIR.glob("*.pdf"))
    
    if not pdfs:
        print("No PDFs found in raw/ directory")
        sys.exit(1)
    
    print(f"Found {len(pdfs)} PDF(s) to ingest\n")
    
    for pdf in pdfs:
        try:
            manifest = ingest_pdf(pdf)
            print(f"\nManifest: {manifest}\n")
        except Exception as e:
            print(f"✗ Failed to ingest {pdf.name}: {e}")
            raise

if __name__ == "__main__":
    main()
