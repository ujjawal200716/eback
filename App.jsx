import React, { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from "@google/generative-ai";
import ReactMarkdown from 'react-markdown';
import * as pdfjsLib from 'pdfjs-dist';
import jsPDF from 'jspdf'; 
// PDF Worker Import
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'; 

// Import your styles
import './App.css';
import logo from './logo.png';

// ==========================================
// 1. CONFIGURATION & API KEYS (UPDATED)
// ==========================================

// ✅ PRODUCTION BACKEND URL
const API_BASE_URL ="https://eduproback1.onrender.com";

const supabaseUrl = 'https://zlzdtzkprmgbixxggkrz.supabase.co';
const supabaseKey = 'sb_publishable_tK1j5PaFwiZW5JyQkygNzw_nYxgwzqW';
const supabase = createClient(supabaseUrl, supabaseKey);

// ⚠️ MULTI-API KEY SYSTEM
// Add as many keys as you want here. The system will rotate through them if one fails.
const ALL_KEYS = [
  import.meta.env.VITE_GEMINI_API_KEY,  // Primary
  import.meta.env.VITE_GEMINI_API_KEY1,
  import.meta.env.VITE_GEMINI_API_KEY2,
  import.meta.env.VITE_GEMINI_API_KEY3,
  import.meta.env.VITE_GEMINI_API_KEY4
];
let currentKeyIndex = 0;

// Initialize Gemini with the first key
let genAI = new GoogleGenerativeAI(ALL_KEYS[currentKeyIndex]);
let model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' }); 

// Helper function to rotate keys
function rotateAPIKey() {
    if (ALL_KEYS.length <= 1) return false; // No other keys to try

    currentKeyIndex = (currentKeyIndex + 1) % ALL_KEYS.length;
    console.warn(`⚠️ API Error. Switching to Key Index: ${currentKeyIndex}`);
    
    // Re-initialize model with new key
    genAI = new GoogleGenerativeAI(ALL_KEYS[currentKeyIndex]);
    model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    return true;
}

// PDF Worker Setup
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;


// ==========================================
// 2. ROBUST AI SERVICE LAYER (UPDATED)
// ==========================================

const SAFETY_LINE = "\n\nIMPORTANT: Do not invent facts. If information is missing, explicitly state what is missing.";

const PROMPTS = {
  // PROMPT 1: Smart Notes with Diagram Triggers
  smartNotes: (text, pageCount) => `
    You are an expert educator. Transform this PDF content (approx ${pageCount} pages) into "Smart Notes".
     
    REQUIREMENTS:
    - Style: "Explain Like I'm 5" (ELI5) but detailed.
    - Structure: Use clear Markdown headings (##), subheadings (###), and bullet points.
    - **Visuals**: Assess if the user would understand the response better with diagrams. If a complex topic (like a biological system, machine part, or physics cycle) is discussed, insert a diagram tag like 

[Image of the human digestive system]
 or 

[Image of hydrogen fuel cell]
. Be economical but strategic. Place the tag on its own line immediately after the concept is introduced.
    - Content: Include Definitions, Key Concepts, and Real-World Analogies.
    - Length: Comprehensive (approx 1000-2000 words).
     
    CONTENT:
    ${text}
    ${SAFETY_LINE}
  `,

  // PROMPT 2: Strict JSON MCQ Generation
  mcqGeneration: (text) => `
    Generate exactly 5 Multiple Choice Questions based on this text.
     
    OUTPUT FORMAT:
    Return ONLY a raw JSON array. Do not wrap in markdown code blocks.
    [
      {
        "question": "Question text?",
        "options": { "A": "...", "B": "...", "C": "...", "D": "..." },
        "correct": "A",
        "explanation": "Why A is correct."
      }
    ]

    CONTENT:
    ${text}
  `,

  // PROMPT 3: ATS Career Report
  careerReport: (resumeText, role) => `
    You are an ATS Resume Expert analyzing a resume for the role of: ${role}.
     
    OUTPUT FORMAT:
    Return raw HTML (no markdown, no \`\`\` tags). Use <h3>, <ul>, <li>, <strong>, <p>.
     
    SECTIONS:
    1. <h3>Match Score</h3>: Give a score out of 100.
    2. <h3>Executive Summary</h3>: 2-3 sentences.
    3. <h3>Key Strengths</h3>: Bullet points.
    4. <h3>Missing Keywords</h3>: Critical skills missing for ${role}.
    5. <h3>Actionable Tips</h3>: 3 specific improvements.

    RESUME CONTENT:
    ${resumeText}
  `,

  // PROMPT 4: Chat Persona
  chatSystem: `You are EduProAI, a helpful tutor. 
  - If the user asks for a diagram, or if a visual would help explain a complex concept (like anatomy, engineering schematics, or geography), use the format 

[Image of X]
 in your response.
  - Explain concepts clearly and concisely.`
};

// --- TIMEOUT HANDLER WITH RETRY LOGIC ---
async function generateWithTimeout(prompt, timeoutMs = 60000) {
    // Retry loop: Tries as many times as there are keys
    for (let attempt = 0; attempt <  ALL_KEYS.length; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
      
        try {
            const result = await model.generateContent(prompt);
            clearTimeout(timeout);
            return { ok: true, text: result.response.text() };
        } catch (error) {
            clearTimeout(timeout);
            
            // Check if we should rotate and retry
            const isLastAttempt = attempt === ALL_KEYS.length - 1;
            
            if (!isLastAttempt) {
                rotateAPIKey(); // Switch key and loop again
                continue;
            }

            // Final Error Handling
            let errorMsg = error.message;
            if (error.name === 'AbortError') errorMsg = "Request timed out (60s limit).";
            return { ok: false, error: errorMsg };
        }
    }
}

// --- GENERATION FUNCTIONS ---

async function generateSmartNotes(text, pageCount) {
    return generateWithTimeout(PROMPTS.smartNotes(text, pageCount));
}

async function generateMCQs(text) {
    const result = await generateWithTimeout(PROMPTS.mcqGeneration(text));
    if (!result.ok) return result;

    try {
        const cleanJson = result.text.replace(/```json/g, '').replace(/```/g, '').trim();
        const mcqs = JSON.parse(cleanJson);
        return { ok: true, mcqs };
    } catch (e) {
        return { ok: false, error: "Failed to parse MCQ JSON." };
    }
}

async function generateCareerReport(resumeText, role) {
    return generateWithTimeout(PROMPTS.careerReport(resumeText, role), 90000);
}

// Helper: Convert File to Base64
async function fileToGenerativePart(file) {
    const base64EncodedDataPromise = new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result.split(',')[1]);
      reader.readAsDataURL(file);
    });
    return {
      inlineData: { data: await base64EncodedDataPromise, mimeType: file.type },
    };
}

// --- FIXED CHAT FUNCTION WITH RETRY ---
async function generateChatAnswer(history, userInput, imagePart = null) {
  // Retry loop for Chat
  for (let attempt = 0; attempt <  ALL_KEYS.length; attempt++) {
      try {
        if (imagePart) {
            const result = await model.generateContent([userInput, imagePart]);
            return { ok: true, text: result.response.text() };
        } 
        
        let geminiHistory = history
            .filter(h => h.role !== 'system')
            .map(h => ({
                role: h.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: h.content }] 
            }));

        if (geminiHistory.length > 0 && geminiHistory[0].role === 'model') {
            geminiHistory.shift();
        }

        const chat = model.startChat({
            history: geminiHistory,
            systemInstruction: {
                role: 'system',
                parts: [{ text: PROMPTS.chatSystem }]
            }
        });

        const result = await chat.sendMessage(userInput);
        return { ok: true, text: result.response.text() };

      } catch (e) { 
          const isLastAttempt = attempt ===  ALL_KEYS.length - 1;
          
          if (!isLastAttempt) {
             rotateAPIKey(); // Switch key
             continue; // Retry logic
          }
          
          console.error("Gemini Chat Error:", e);
          return { ok: false, error: e.message }; 
      }
  }
}


// ==========================================
// 3. UTILITIES (PDF, DB)
// ==========================================

const extractTextFromPDF = async (file) => {
  const arrayBuffer = await file.arrayBuffer();
  
  const pdf = await pdfjsLib.getDocument({ 
    data: arrayBuffer,
    cMapUrl: 'https://unpkg.com/pdfjs-dist@5.4.624/cmaps/',
    cMapPacked: true,
  }).promise;

  let fullText = '';
  const maxPages = Math.min(pdf.numPages, 10);
  
  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map(item => item.str).join(' ');
    fullText += `\n--- Page ${i} ---\n${pageText}`;
  }
  return { text: fullText, pages: pdf.numPages };
};

const downloadAsPDF = (title, contentLines) => {
    const doc = new jsPDF();
    const pageHeight = doc.internal.pageSize.height;
    const margin = 20;
    let cursorY = 20;

    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    doc.text(title, margin, cursorY);
    cursorY += 15;

    doc.setFontSize(11);
    doc.setFont("helvetica", "normal");
    
    contentLines.forEach(line => {
        if (cursorY > pageHeight - margin) {
            doc.addPage();
            cursorY = margin;
        }
        const splitText = doc.splitTextToSize(line, 170);
        doc.text(splitText, margin, cursorY);
        const blockHeight = splitText.length * 7; 
        cursorY += blockHeight + 2;
    });

    doc.save(`${title.replace(/\s+/g, '_')}_Analysis.pdf`);
};

// ==========================================
// 4. COMPONENTS
// ==========================================

// --- UPDATED: SAVED DATA MODAL ---
// Now supports 'onRestore' to make data accessible
function SavedDataModal({ user, onClose, onRestore }) {
  const [activeTab, setActiveTab] = useState('notes');
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        
        if (!token) return;

        const endpoint = activeTab === 'notes' ? 'notes' : 'career';
        // ✅ UPDATED: Using Render Backend
        const res = await fetch(`${API_BASE_URL}/api/${endpoint}`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        
        if (res.ok) {
            const json = await res.json();
            setData(Array.isArray(json) ? json : []);
        } else {
            console.error("Failed to fetch");
        }
      } catch (err) {
        console.error("Failed to fetch data", err);
        setData([]);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [activeTab]); 

  return (
    <div className="loading-overlay" style={{background: 'rgba(0,0,0,0.8)'}} onClick={onClose}>
      <div className="glass-card slide-up" style={{maxWidth: '800px', width: '90%', maxHeight: '85vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: '0'}} onClick={e => e.stopPropagation()}>
        
        {/* Header */}
        <div style={{padding: '20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
          <h2 style={{margin:0, color: 'var(--text-main)'}}>My History</h2>
          <button onClick={onClose} style={{background: 'transparent', border:'none', fontSize: '1.5rem', cursor:'pointer', color:'var(--text-muted)'}}>✕</button>
        </div>

        {/* Tabs */}
        <div style={{display: 'flex', borderBottom: '1px solid var(--border)'}}>
          <button 
            style={{flex:1, padding: '15px', background: activeTab === 'notes' ? 'var(--primary)' : 'transparent', border:'none', color: activeTab === 'notes' ? 'white' : 'var(--text-muted)', cursor: 'pointer', fontWeight: 'bold'}}
            onClick={() => setActiveTab('notes')}
          >
            Study Notes
          </button>
          <button 
            style={{flex:1, padding: '15px', background: activeTab === 'career' ? 'var(--primary)' : 'transparent', border:'none', color: activeTab === 'career' ? 'white' : 'var(--text-muted)', cursor: 'pointer', fontWeight: 'bold'}}
            onClick={() => setActiveTab('career')}
          >
            Career Reports
          </button>
        </div>

        {/* Content List */}
        <div style={{flex: 1, overflowY: 'auto', padding: '20px'}}>
          {loading ? (
            <div style={{textAlign: 'center', padding: '20px'}}>Loading...</div>
          ) : data.length === 0 ? (
            <div style={{textAlign: 'center', padding: '40px', color: 'var(--text-muted)'}}>No saved data found.</div>
          ) : (
            <div style={{display: 'grid', gap: '15px'}}>
              {data.map((item, i) => (
                <div 
                  key={i} 
                  onClick={() => onRestore(activeTab, item)}
                  style={{
                    background: 'var(--bg-input)', 
                    padding: '15px', 
                    borderRadius: '12px', 
                    border: '1px solid var(--border)', 
                    cursor: 'pointer',
                    transition: 'transform 0.2s, background 0.2s'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-card)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'var(--bg-input)'}
                >
                  {activeTab === 'notes' ? (
                    <>
                      <div style={{display:'flex', justifyContent:'space-between'}}>
                          <h3 style={{margin: '0 0 5px 0', color: 'var(--text-main)'}}>{item.title}</h3>
                          <span style={{fontSize:'1.2rem'}}>↗️</span>
                      </div>
                      <p style={{margin: 0, fontSize: '0.9rem', color: 'var(--text-muted)'}}>
                        {item.pages} Pages • {new Date(item.createdAt || item.date).toLocaleDateString()}
                      </p>
                    </>
                  ) : (
                    <>
                        <div style={{display:'flex', justifyContent:'space-between'}}>
                          <h3 style={{margin: '0 0 5px 0', color: 'var(--text-main)'}}>{item.role}</h3>
                          <span style={{fontSize:'1.2rem'}}>↗️</span>
                      </div>
                      <p style={{margin: 0, fontSize: '0.9rem', color: 'var(--text-muted)'}}>
                        Report Generated • {new Date(item.createdAt || item.date).toLocaleDateString()}
                      </p>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- HOME PAGE ---
function HomePage({ onNavigate }) {
  const [activeFaq, setActiveFaq] = useState(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => { setIsVisible(true); }, []);

  const workflow = [
    { step: '01', title: 'Upload', desc: 'Drop your PDF notes or Resume.', icon: '📤' },
    { step: '02', title: 'Analyze', desc: 'AI extracts insights & diagrams.', icon: '🧠' },
    { step: '03', title: 'Learn', desc: 'Get summaries, quizzes, or feedback.', icon: '🚀' },
  ];

  const features = [
    { icon: '📝', title: 'Smart Notes', description: 'Turn complex PDFs into ELI5 summaries with Diagram suggestions.' },
    { icon: '🎯', title: 'Career Coach', description: 'ATS-friendly resume analysis with scoring.' },
    { icon: '💬', title: 'Context Chat', description: 'Chat with your documents or images.' },
    { icon: '🔒', title: 'Privacy First', description: 'Local-first processing.' },
    { icon: '⚡', title: 'Instant Results', description: 'No waiting queues.' },
    { icon: '📊', title: 'System Health', description: 'Real-time diagnostics.' },
  ];

  const faqs = [
    { q: "Is EduProAI free?", a: "Yes! The core features are open for students." },
    { q: "Can it generate Diagrams?", a: "No, the AI will suggest diagram placeholders for complex topics." },
    { q: "Is my data saved?", a: "Files are processed in memory and not permanently stored on our servers." },
  ];

  return (
    <div className={`home-container ${isVisible ? 'fade-in' : ''}`}>
      <section className="hero-section">
        <div className="hero-blob blob-1"></div>
        <div className="hero-blob blob-2"></div>
        <div className="hero-badge"><span></span> New: Visual Learning Support</div>
        
        <h1 className="hero-title">
          Master Your Studies.<br />
          <span className="text-gradient">Accelerate Your Career.</span>
        </h1>
        
        <p className="hero-subtitle">
          The all-in-one AI platform that turns your study materials into interactive notes and your resume into a job-magnet.
        </p>
        
        <div className="hero-buttons">
          <button className="btn btn-primary btn-xl" onClick={() => onNavigate('notes')}>Start Learning</button>
          <button className="btn btn-secondary btn-xl" onClick={() => onNavigate('career')}>Check Resume</button>
        </div>
      </section>

      <section className="workflow-section">
        <h2 className="section-title">How It Works</h2>
        <div className="workflow-steps">
          {workflow.map((item, idx) => (
            <div key={idx} className="step-card">
              <div className="step-number">{item.step}</div>
              <div className="step-icon">{item.icon}</div>
              <h3>{item.title}</h3>
              <p>{item.desc}</p>
              {idx !== workflow.length - 1 && <div className="step-connector">→</div>}
            </div>
          ))}
        </div>
      </section>

      <section className="features-section">
        <h2 className="section-title">Everything You Need</h2>
        <div className="features-grid">
          {features.map((feature, idx) => (
            <div key={idx} className="feature-card">
              <div className="feature-icon-wrapper">{feature.icon}</div>
              <h3>{feature.title}</h3>
              <p>{feature.description}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="faq-section">
        <h2 className="section-title">Frequently Asked Questions</h2>
        <div className="faq-grid">
          {faqs.map((item, idx) => (
            <div 
              key={idx} 
              className={`faq-item ${activeFaq === idx ? 'active' : ''}`}
              onClick={() => setActiveFaq(activeFaq === idx ? null : idx)}
            >
              <div className="faq-question">
                {item.q}
                <span className="faq-toggle">{activeFaq === idx ? '−' : '+'}</span>
              </div>
              <div className="faq-answer">{item.a}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="cta-section">
        <h2>Ready to upgrade your workflow?</h2>
        <button className="btn btn-light btn-xl" onClick={() => onNavigate('notes')}>Get Started for Free</button>
      </section>
    </div>
  );
}

// --- UPDATED: NOTES PAGE ---
function NotesPage({ user, restoredNote, clearRestoredNote }) {
  const [generatedNote, setGeneratedNote] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState('Processing...');
  const [pdfFile, setPdfFile] = useState(null);

  // Effect to load data from History if passed via props
  useEffect(() => {
    if (restoredNote) {
        setGeneratedNote(restoredNote);
        setPdfFile(null); 
        clearRestoredNote();
    }
  }, [restoredNote, clearRestoredNote]);

  const handleGenerate = async (e) => {
    e.preventDefault();
    if (!pdfFile) return;
    
    setLoading(true);
    
    try {
      setLoadingText('Extracting text (Max 10 pages)...');
      const { text, pages } = await extractTextFromPDF(pdfFile);

      setLoadingText('AI is visualizing concepts & summarizing...');
      const noteResult = await generateSmartNotes(text, pages);
      
      if (!noteResult.ok) throw new Error(noteResult.error);
      const smartNotes = noteResult.text;

      setLoadingText('Creating practice questions...');
      const mcqResult = await generateMCQs(text);
      const mcqs = mcqResult.ok ? mcqResult.mcqs : [];

      const tempNoteObject = {
        title: pdfFile.name.replace('.pdf', ''),
        smart_notes: smartNotes,
        mcq_json: mcqs,
        pages: pages,
        date: new Date().toISOString()
      };

      setGeneratedNote(tempNoteObject);
      setPdfFile(null); 

    } catch (error) {
      console.error(error);
      alert("Error: " + error.message);
    } finally {
      setLoading(false);
      setLoadingText('Processing...');
    }
  };

  const handleSaveToCloud = async () => {
    if (!user) { alert("Please login to save notes to the cloud."); return; }
    if (!generatedNote) return;

    try {
        const { data: { session } } = await supabase.auth.getSession();
        
        // ✅ UPDATED: Using Render Backend
        const response = await fetch(`${API_BASE_URL}/api/notes`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session?.access_token}` 
            },
            body: JSON.stringify({
                title: generatedNote.title,
                smart_notes: generatedNote.smart_notes,
                mcq_json: generatedNote.mcq_json,
                pages: generatedNote.pages || 1
            }),
        });
        const data = await response.json();
        if (data.success) alert("✅ Success! Note saved to your profile.");
        else alert("Failed: " + data.error);
    } catch (error) {
        console.error("Server Error:", error);
        alert("Could not connect to server.");
    }
  };

  const handleDownload = () => {
    if(!generatedNote) return;

    const noteLines = generatedNote.smart_notes.split('\n');

    const content = [
        "--- STUDY NOTES ---", 
        ...noteLines,
        "", 
        "--- PRACTICE QUIZ ---"
    ];

    if(generatedNote.mcq_json) {
        generatedNote.mcq_json.forEach((q, i) => {
            content.push(`${i+1}. ${q.question}`);
            Object.entries(q.options).forEach(([k,v]) => content.push(`   (${k.toUpperCase()}) ${v}`));
            content.push(`   Answer: ${q.correct.toUpperCase()}`);
            content.push("");
        });
    }
    downloadAsPDF(generatedNote.title, content);
  };

  const handleStartOver = () => {
      setGeneratedNote(null);
      setPdfFile(null);
  };

  return (
    // Container with decreased gap (100px)
    <div className="notes-container slide-up" style={{ paddingTop: '100px' }}>
      
      {/* Loading Overlay */}
      {loading && (
        <div className="loading-overlay">
            <div className="spinner"></div>
            <div style={{marginTop:'15px', color:'white', fontWeight:'500'}}>{loadingText}</div>
        </div>
      )}
      
      {/* VIEW 1: UPLOAD FORM */}
      {!generatedNote && (
        <div className="career-container" style={{paddingTop: '0', marginTop: '0', width: '100%'}}>
              <div className="header-section text-center" style={{marginBottom: '2rem'}}>
                 <h1 className="page-title">AI Note Generator</h1>
                 <p style={{color:'var(--text-muted)'}}>Upload a PDF to instantly generate summaries and quizzes.</p>
              </div>

            <div className="glass-card slide-up" style={{maxWidth: '600px', margin:'0 auto'}}>
                <form onSubmit={handleGenerate}>
                    <div className="form-group">
                        <label className="form-label">Upload Document</label>
                        <div 
                            className={`upload-area ${pdfFile ? 'has-file' : ''}`}
                            onClick={() => document.getElementById('note-file-upload').click()}
                        >
                            <input 
                                id="note-file-upload"
                                type="file" 
                                accept=".pdf" 
                                onChange={(e) => setPdfFile(e.target.files[0])} 
                                style={{display:'none'}}
                            />
                            
                            {pdfFile ? (
                                <div className="file-info slide-up">
                                    <span style={{fontSize: '2rem'}}>📄</span>
                                    <span className="file-name">{pdfFile.name}</span>
                                    <button 
                                        type="button" 
                                        className="remove-btn" 
                                        onClick={(e) => { e.stopPropagation(); setPdfFile(null); }}
                                    >
                                        Remove
                                    </button>
                                </div>
                            ) : (
                                <div className="upload-label">
                                    <span className="icon" style={{fontSize:'2.5rem'}}>📚</span>
                                    <span className="text-main">Click to Upload PDF</span>
                                    <span className="text-sub">Max 10 pages analyzed</span>
                                </div>
                            )}
                        </div>
                    </div>
                    <button className="action-btn btn-primary" disabled={!pdfFile}>
                        {loading ? "Analyzing..." : "Generate Notes ✨"}
                    </button>
                </form>
            </div>
        </div>
      )}

      {/* VIEW 2: RESULTS DISPLAY */}
      {generatedNote && (
        <div className="slide-up" style={{ width: '100%' }}>
            {/* Header row with Back button */}
            <div className="detail-header-row" style={{
                display:'flex', 
                justifyContent:'space-between', 
                alignItems:'center', 
                marginBottom:'15px',
                marginTop: '0px',
                flexWrap: 'wrap',
                gap: '10px'
            }}>
                <button className="btn-back" onClick={handleStartOver} style={{background:'transparent', border:'none', color:'var(--text-muted)', cursor:'pointer', fontSize:'1rem'}}>
                    ← Analyze Another
                </button>
                
                <div style={{display:'flex', gap:'10px'}}>
                    <button className="btn-secondary" onClick={handleSaveToCloud} style={{padding:'8px 16px', borderRadius:'8px', cursor:'pointer', border:'1px solid var(--border)', background:'transparent', color:'var(--text-main)'}}>
                        {user ? "☁️ Save to Cloud" : "Login to Save"}
                    </button>
                    <button className="btn-primary" onClick={handleDownload} style={{padding:'8px 16px', borderRadius:'8px', cursor:'pointer', border:'none', background:'var(--primary)', color:'white'}}>
                        📥 Download PDF
                    </button>
                </div>
            </div>
            
            {/* Note Content */}
            <div className="report-paper">
                <h2 style={{color: 'var(--text-main)', borderBottom:'1px solid var(--border)', paddingBottom:'10px', marginBottom:'20px'}}>
                    {generatedNote.title}
                </h2>
                <div className="markdown-body" style={{color: 'var(--text-main)'}}>
                    <ReactMarkdown>{generatedNote.smart_notes}</ReactMarkdown>
                </div>
            </div>

            {/* Quiz Content */}
            {generatedNote.mcq_json && generatedNote.mcq_json.length > 0 && (
                <div className="report-paper" style={{marginTop: '20px'}}>
                    <h3 style={{color: 'var(--primary)', marginBottom:'15px'}}>Practice Quiz</h3>
                    {generatedNote.mcq_json.map((q, i) => (
                        <div key={i} className="mcq-container" style={{background:'var(--bg-input)', padding:'15px', borderRadius:'12px', marginBottom:'15px', border:'1px solid var(--border)'}}>
                            <p style={{fontWeight:'bold', color:'var(--text-main)', marginBottom:'10px'}}>
                                {i+1}. {q.question}
                            </p>
                            <div className="mcq-options-list" style={{display:'grid', gap:'8px'}}>
                                {Object.entries(q.options).map(([k, v]) => (
                                    <div key={k} style={{
                                        padding:'8px 12px', 
                                        borderRadius:'8px', 
                                        background: k === q.correct ? 'rgba(16, 185, 129, 0.1)' : 'var(--bg-card)',
                                        border: k === q.correct ? '1px solid #10b981' : '1px solid var(--border)',
                                        color: 'var(--text-main)',
                                        display: 'flex',
                                        justifyContent: 'space-between'
                                    }}>
                                        <span><span style={{fontWeight:'bold'}}>{k.toUpperCase()})</span> {v}</span>
                                        {k === q.correct && <span>✅</span>}
                                    </div>
                                ))}
                            </div>
                            <p style={{marginTop:'10px', fontSize:'0.9rem', color:'var(--text-muted)', fontStyle:'italic'}}>
                                💡 {q.explanation}
                            </p>
                        </div>
                    ))}
                </div>
            )}
        </div>
      )}
    </div>
  );
}

// --- UPDATED: CAREER PAGE ---
function CareerPage({ user, restoredReport, clearRestoredReport }) {
  const [file, setFile] = useState(null);
  const [role, setRole] = useState('');
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);

  // Effect to load data from History if passed via props
  useEffect(() => {
    if (restoredReport) {
        setReport(restoredReport.report_html);
        setRole(restoredReport.role);
        setFile(null);
        clearRestoredReport();
    }
  }, [restoredReport, clearRestoredReport]);

  const handleRemoveFile = (e) => {
    e.stopPropagation(); 
    e.preventDefault();
    setFile(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file || !role) return;
    
    setLoading(true);
    try {
      const { text } = await extractTextFromPDF(file);
      const result = await generateCareerReport(text.substring(0, 15000), role);
      
      if (!result.ok) throw new Error(result.error);
      setReport(result.text);
    } catch (error) {
      console.error(error);
      alert("Error analyzing resume: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveToCloud = async () => {
    if (!user) { alert("Please login to save."); return; }
    if (!report) return;

    try {
        const { data: { session } } = await supabase.auth.getSession();

        // ✅ UPDATED: Using Render Backend
        const response = await fetch(`${API_BASE_URL}/api/career`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session?.access_token}` 
            },
            body: JSON.stringify({
                role: role,
                report_html: report
            }),
        });

        const data = await response.json();
        if (data.success) alert("✅ Career Report Saved!");
        else alert("❌ Failed: " + data.error);
    } catch (error) {
        console.error("Server Error", error);
        alert("Server connection failed.");
    }
  };

  const handleDownloadReport = () => {
    if (!report) return;
    const textContent = report.replace(/<[^>]+>/g, '\n').replace(/\n\s*\n/g, '\n');
    const lines = textContent.split('\n');
    downloadAsPDF(`Career_Analysis_${role.replace(/\s+/g, '_')}`, lines);
  };

  return (
    <div className="career-container">
      <div className="header-section text-center">
        <h1 className="page-title">Career Coach AI</h1>
        {!report && <p style={{color: 'var(--text-muted)', marginBottom: '2rem'}}>Upload your resume to get ATS scores, skill gaps, and interview tips.</p>}
      </div>

      {!report ? (
        <div className="glass-card slide-up">
          {loading && (
            <div className="loading-overlay">
              <div className="spinner"></div>
              <p style={{marginTop: '1rem', color: 'white', fontWeight: '600'}}>Analyzing your profile...</p>
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">Target Job Role</label>
              <input 
                className="modern-input" 
                value={role} 
                onChange={e => setRole(e.target.value)} 
                placeholder="e.g. Full Stack Developer" 
              />
            </div>

            <div className="form-group">
              <label className="form-label">Upload Resume (PDF)</label>
              <div 
                className={`upload-area ${file ? 'has-file' : ''}`}
                onClick={() => document.getElementById('hidden-file-input').click()}
              >
                <input 
                  id="hidden-file-input"
                  type="file" 
                  accept=".pdf" 
                  style={{display: 'none'}} 
                  onChange={e => setFile(e.target.files[0])} 
                />
                {file ? (
                  <div className="file-info slide-up">
                    <span style={{fontSize: '2rem'}}>📄</span>
                    <span className="file-name">{file.name}</span>
                    <button className="remove-btn" onClick={handleRemoveFile}>🗑️ Remove</button>
                  </div>
                ) : (
                  <div className="upload-label text-center">
                    <span style={{fontSize: '2.5rem', opacity: 0.5}}>☁️</span>
                    <p style={{fontWeight: 600, marginTop: '10px'}}>Click to Upload Resume</p>
                    <p style={{fontSize: '0.8rem', color: 'var(--text-muted)'}}>PDF only (Max 5MB)</p>
                  </div>
                )}
              </div>
            </div>

            <button className="action-btn btn-primary" disabled={!file || !role}>
              {loading ? "Analyzing..." : "Analyze Resume 🚀"}
            </button>
          </form>
        </div>
      ) : (
        <div className="report-view" style={{width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center'}}>
          <div className="action-bar" style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', maxWidth: '800px', marginBottom: '1.5rem'}}>
             <button className="btn-back" onClick={() => setReport(null)} style={{background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', padding: '0.8rem 1.5rem', borderRadius: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600}}>
                <span>←</span> Start Over
             </button>
             <div style={{display:'flex', gap:'10px'}}>
                <button className="btn-secondary" onClick={handleSaveToCloud} style={{padding:'0.8rem 1.5rem', borderRadius: '12px', border:'1px solid var(--border)', background:'transparent', color:'var(--text-main)', cursor:'pointer'}}>
                    {user ? "☁️ Save to Profile" : "Login to Save"}
                </button>
                <button onClick={handleDownloadReport} style={{background: 'linear-gradient(135deg, var(--primary) 0%, #3b82f6 100%)', color: 'white', border: 'none', padding: '0.8rem 2rem', borderRadius: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', fontWeight: 'bold', boxShadow: '0 4px 15px rgba(59, 130, 246, 0.4)'}}>
                    <span style={{fontSize: '1.2rem'}}>📥</span> Download PDF
                </button>
             </div>
          </div>

          <div className="report-paper">
             <div className="report-header" style={{borderBottom: '1px solid var(--border)', paddingBottom: '1rem', marginBottom: '2rem'}}>
                <h2 style={{color: 'var(--text-main)'}}>Analysis Report: {role}</h2>
                <span style={{color: 'var(--text-muted)', fontSize: '0.9rem'}}>Generated by EduProAI</span>
             </div>
             <div className="report-content" dangerouslySetInnerHTML={{ __html: report }} />
          </div>
        </div>
      )}
    </div>
  );
}

// --- CHATBOT PAGE ---
function ChatbotPage({ user }) {
  const [msgs, setMsgs] = useState([
    { 
      role: 'assistant', 
      content: 'Hello! I am your AI Study Buddy. Ask me anything or upload multiple photos or PDFs!' 
    }
  ]);
  const [input, setInput] = useState('');
  const [files, setFiles] = useState([]); 
  const [previews, setPreviews] = useState([]); 
  const [loading, setLoading] = useState(false);
  
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const userInitial = user?.user_metadata?.full_name?.charAt(0).toUpperCase() || 'U';

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, loading]);

  useEffect(() => {
    return () => {
        previews.forEach(p => URL.revokeObjectURL(p.url));
    };
  }, [previews]);

  const handleFileSelect = (e) => {
    const selectedFiles = Array.from(e.target.files);
    if (selectedFiles.length > 0) {
      setFiles(prev => [...prev, ...selectedFiles]);
      
      const newPreviews = selectedFiles.map(file => ({
          url: URL.createObjectURL(file),
          type: file.type,
          name: file.name
      }));
      setPreviews(prev => [...prev, ...newPreviews]);
    }
    if(fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeFile = (indexToRemove) => {
    // 1. Update files state
    setFiles(prev => prev.filter((_, i) => i !== indexToRemove));
    
    // 2. Update previews state and clean up memory
    setPreviews(prev => {
        const newPreviews = [...prev];
        const removed = newPreviews.splice(indexToRemove, 1)[0];
        if (removed && removed.url) {
            URL.revokeObjectURL(removed.url); // Memory management
        }
        return newPreviews;
    });
  };

  const send = async (e) => {
    e.preventDefault();
    if (!input.trim() && files.length === 0) return;

    const currentAttachments = previews.map(p => ({
        isImage: p.type.startsWith('image/'),
        url: p.url,
        name: p.name
    }));

    const newMsg = { 
        role: 'user', 
        content: input, 
        attachments: currentAttachments
    };

    setMsgs(prev => [...prev, newMsg]);
    setLoading(true);
    setInput('');
    
    const filesToSend = [...files]; 
    setFiles([]);
    setPreviews([]);

    try {
      const filePartsPromise = filesToSend.map(f => fileToGenerativePart(f));
      const fileParts = await Promise.all(filePartsPromise);

      const result = await generateChatAnswer(msgs, input || (fileParts.length ? "Analyze these files" : ""), fileParts);
      
      if (!result.ok) throw new Error(result.error);
      setMsgs(prev => [...prev, { role: 'assistant', content: result.text }]);

    } catch (error) {
      console.error("Error:", error);
      setMsgs(prev => [...prev, { role: 'assistant', content: "Sorry, something went wrong. " + error.message }]);
    } finally {
      setLoading(false);
    }
  };

  const handleAttachClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="chat-page-container">
        <div className="chat-layout">
            <div className="msgs-area">
                {msgs.length === 1 && (
                    <div className="chat-intro">
                        <div className="intro-logo-wrapper">
                            <img src={logo} alt="Logo" />
                        </div>
                        <h2>AI Study Buddy</h2>
                        <p>Ask questions or upload notes to get started.</p>
                    </div>
                )}

                {msgs.map((m, i) => (
                    <div key={i} className={`msg ${m.role}`}>
                        <div className="chat-avatar">
                            {m.role === 'assistant' ? (
                                <img src={logo} alt="AI" />
                            ) : (
                                <span>{userInitial}</span>
                            )}
                        </div>
                        <div className="bubble">
                            {m.attachments && m.attachments.length > 0 && (
                                <div style={{display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '8px'}}>
                                    {m.attachments.map((att, idx) => (
                                        att.isImage ? (
                                            <div key={idx} className="msg-image-bubble">
                                                <img src={att.url} alt="att" />
                                            </div>
                                        ) : (
                                            <div key={idx} style={{background:'rgba(0,0,0,0.1)', padding:'5px 10px', borderRadius:'8px', fontSize:'0.85rem'}}>
                                                📄 {att.name}
                                            </div>
                                        )
                                    ))}
                                </div>
                            )}
                            <ReactMarkdown>{m.content}</ReactMarkdown>
                        </div>
                    </div>
                ))}

                {loading && (
                    <div className="msg assistant">
                        <div className="chat-avatar">
                            <img src={logo} alt="AI" />
                        </div>
                        <div className="bubble typing-bubble">
                            <span className="dot">...</span>
                        </div>
                    </div>
                )}
                
                <div ref={messagesEndRef} />
            </div>

            <div className="floating-input-container">
                {previews.length > 0 && (
                    <div style={{
                        position: 'absolute', 
                        bottom: '100%', 
                        left: '2rem', 
                        display: 'flex', 
                        gap: '12px', 
                        marginBottom: '10px',
                        zIndex: 10 // Added z-index to ensure it sits above chat messages
                    }}>
                        {previews.map((prev, index) => (
                            <div key={index} className="image-preview-pill" style={{position: 'relative', bottom: 'auto', left: 'auto', margin: 0}}>
                                {prev.type.startsWith('image/') ? (
                                    <img src={prev.url} alt="preview" />
                                ) : (
                                    <div style={{display:'flex', alignItems:'center', justifyContent:'center', width:'100%', height:'100%', background:'#334155', color:'white', borderRadius:'10px'}}>
                                        📄
                                    </div>
                                )}
                                {/* FIXED: Added type="button" and e.preventDefault() */}
                                <button 
                                    type="button" 
                                    onClick={(e) => { e.preventDefault(); removeFile(index); }}
                                >
                                    ✕
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                <form className="input-pill" onSubmit={send}>
                    <input 
                        type="file" 
                        multiple 
                        className="hidden-input"
                        ref={fileInputRef}
                        onChange={handleFileSelect}
                        accept="image/*,.pdf,.doc,.docx,.txt"
                    />
                    <button type="button" className="btn-icon-attach" onClick={handleAttachClick} title="Attach Files">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                    </button>
                    <input 
                        type="text" 
                        className="clean-input"
                        placeholder={files.length > 0 ? `Ask about ${files.length} files...` : "Type a message..."}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        autoComplete="off"
                    />
                    <button type="submit" className="btn-send-round" disabled={!input.trim() && files.length === 0}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                    </button>
                </form>
            </div>
        </div>
    </div>
  );
}
// --- LOGIN PAGE ---
function LoginPage({ onLoginSuccess }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleAuth = async (e) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');

    try {
      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({ 
          email, password,
          options: { data: { full_name: fullName } }
        });
        if (error) throw error;
        if (data.session) onLoginSuccess(data.user);
        else setErrorMsg("Account created! Check email.");
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        onLoginSuccess(data.user);
      }
    } catch (err) { setErrorMsg(err.message); } 
    finally { setLoading(false); }
  };

  return (
    <div className="login-container slide-up">
      <div className="login-card">
          <h2 className="login-title">{isSignUp ? 'Create Account' : 'Welcome Back'}</h2>
          <p className="login-subtitle">{isSignUp ? 'Start your journey with us.' : 'Enter your details.'}</p>
          
          {errorMsg && <div className="alert alert-error">{errorMsg}</div>}

          <form onSubmit={handleAuth}>
              {isSignUp && (
                <div className="input-group">
                   <label className="input-label">Full Name</label>
                   <input className="login-input" type="text" value={fullName} onChange={e => setFullName(e.target.value)} required={isSignUp} placeholder="e.g. eduprotdy user" />
                </div>
              )}
              <div className="input-group">
                 <label className="input-label">Email</label>
                 <input className="login-input" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
              </div>
              <div className="input-group">
                 <label className="input-label">Password</label>
                 <input className="login-input" type="password" value={password} onChange={e => setPassword(e.target.value)} required />
              </div>
              <button className="login-btn-primary" disabled={loading}>
                 {loading ? 'Processing...' : (isSignUp ? 'Sign Up' : 'Login')}
              </button>
          </form>
          
          <p className="toggle-text">
             {isSignUp ? 'Already have an account?' : 'No account?'} 
             <span className="toggle-link" onClick={()=>{ setIsSignUp(!isSignUp); setErrorMsg(''); setFullName(''); }}>
               {isSignUp ? 'Login' : 'Sign Up'}
             </span>
          </p>
      </div>
    </div>
  );
}

// --- PROFILE MENU (UPDATED) ---
function ProfileMenu({ user, onLogout, isDarkMode, toggleTheme, onShowHistory }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [newName, setNewName] = useState('');
  const [updating, setUpdating] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsOpen(false);
        setIsEditing(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const displayName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'User';
  const initial = displayName.charAt(0).toUpperCase();

  const handleEditClick = (e) => {
    e.stopPropagation();
    setNewName(displayName);
    setIsEditing(true);
  };

  const handleSaveName = async () => {
    if (!newName.trim()) return;
    setUpdating(true);
    try {
        const { error } = await supabase.auth.updateUser({ data: { full_name: newName } });
        if (error) throw error;
        setIsEditing(false);
    } catch (error) { console.error("Error updating name:", error.message); } 
    finally { setUpdating(false); }
  };

  const handleKeyDown = (e) => {
      if (e.key === 'Enter') handleSaveName();
      if (e.key === 'Escape') setIsEditing(false);
  };

  return (
    <div className="profile-container" ref={menuRef}>
      <button className="avatar-btn" onClick={() => setIsOpen(!isOpen)}>{initial}</button>
      {isOpen && (
        <div className="profile-dropdown">
          <div className="menu-header">
            <div className="menu-header-avatar">{initial}</div>
            {isEditing ? (
                <div className="name-edit-container">
                    <input className="name-edit-input" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={handleKeyDown} autoFocus disabled={updating} />
                    <button className="name-save-btn" onClick={handleSaveName} disabled={updating}>{updating ? '...' : '✓'}</button>
                </div>
            ) : (
                <div className="menu-name editable-name" onClick={handleEditClick} title="Click to edit name">{displayName}</div>
            )}
            <div className="menu-email">{user.email}</div>
          </div>
          
          {/* NEW: MY HISTORY BUTTON */}
          <div className="menu-item" onClick={() => { setIsOpen(false); onShowHistory(); }}>
            <div className="menu-item-content">
              <span>📂</span>
              <span>My History</span>
            </div>
          </div>

          <div className="menu-item" onClick={toggleTheme}>
            <div className="menu-item-content">
              <span>{isDarkMode ? '🌙' : '☀️'}</span>
              <span>Appearance</span>
            </div>
            <div className={`toggle-switch ${isDarkMode ? 'active' : ''}`}><div className="toggle-thumb" /></div>
          </div>
          <button className="logout-btn" onClick={onLogout}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
            Sign Out
          </button>
        </div>
      )}
    </div>
  );
}

// ==========================================
// 5. MAIN APP (UPDATED)
// ==========================================

function App() {
  const [tab, setTab] = useState('home');
  const [user, setUser] = useState(null);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  
  // NEW STATES: Data restored from history
  const [restoredNote, setRestoredNote] = useState(null);
  const [restoredReport, setRestoredReport] = useState(null);
  
  // NEW STATE: Server Status
  const [serverStatus, setServerStatus] = useState('checking'); // 'checking', 'online', 'offline'

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setUser(session?.user ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    setIsDarkMode(prefersDark);
    if(prefersDark) document.body.classList.add('dark-mode');

    // 🔄 AUTOMATIC WAKE-UP PING
    const wakeUpServer = async () => {
      try {
        console.log("Pinging server to wake it up...");
        const res = await fetch(`${API_BASE_URL}/`); // Hits the backend health check
        if (res.ok) {
          console.log("✅ Server is awake!");
          setServerStatus('online');
        } else {
          setServerStatus('offline');
        }
      } catch (e) {
        console.error("Server is likely sleeping or down:", e);
        setServerStatus('offline');
      }
    };
    wakeUpServer();

    return () => subscription.unsubscribe();
  }, []);

  const handleLogout = async () => {
      await supabase.auth.signOut();
      setTab('home');
      setShowHistory(false);
      setRestoredNote(null);
      setRestoredReport(null);
  };

  const toggleTheme = () => {
    setIsDarkMode(!isDarkMode);
    if (!isDarkMode) document.body.classList.add('dark-mode');
    else document.body.classList.remove('dark-mode');
  };

  // --- NEW HANDLER: RESTORE DATA FROM MODAL ---
  const handleRestoreFromHistory = (type, item) => {
    if (type === 'notes') {
        setRestoredNote(item);
        setTab('notes');
    } else {
        setRestoredReport(item);
        setTab('career');
    }
    setShowHistory(false);
  };

  return (
    <div className="app">
      <nav className="navbar">
        <div className="nav-left" onClick={() => setTab('home')}>
           <img src={logo} alt="EduProAI Logo" className="logo-img" />
           <span className="nav-brand">EduProAI</span>
        </div>
        <div className="nav-center">
          {['home', 'notes', 'career', 'chatbot'].map(t => (
            <button key={t} onClick={() => setTab(t)} className={`nav-pill ${tab === t ? 'active' : ''}`}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        <div className="nav-right" style={{display: 'flex', alignItems: 'center', gap: '15px'}}>
           {/* SERVER STATUS INDICATOR */}
           <div style={{ fontSize: '0.8rem', fontWeight: '500' }}>
              {serverStatus === 'checking' && <span style={{color: 'orange'}}>🟠 Waking...</span>}
              {serverStatus === 'online' && <span style={{color: '#10b981'}}>🟢 Ready</span>}
              {serverStatus === 'offline' && <span style={{color: '#ef4444'}}>🔴 Offline</span>}
           </div>

           {user ? (
               <ProfileMenu 
                 user={user} 
                 onLogout={handleLogout} 
                 isDarkMode={isDarkMode} 
                 toggleTheme={toggleTheme}
                 onShowHistory={() => setShowHistory(true)}
               />
           ) : (
               <button className="nav-login-btn" onClick={() => setTab('login')}>Login</button>
           )}
        </div>
      </nav>
          
          {/* HISTORY MODAL with restore handler */}
          {showHistory && (
            <SavedDataModal 
                user={user} 
                onClose={() => setShowHistory(false)} 
                onRestore={handleRestoreFromHistory} 
            />
          )}

          {tab === 'home' && <HomePage onNavigate={setTab} />}
          
          {tab === 'notes' && (
            <NotesPage 
                user={user} 
                restoredNote={restoredNote} 
                clearRestoredNote={() => setRestoredNote(null)} 
            />
          )}
          
          {tab === 'career' && (
            <CareerPage 
                user={user} 
                restoredReport={restoredReport} 
                clearRestoredReport={() => setRestoredReport(null)}
            />
          )}
          
          {tab === 'chatbot' && <ChatbotPage user={user} />}
          {tab === 'login' && <LoginPage onLoginSuccess={(u) => { setUser(u); setTab('home'); }} />}
    </div>
  );
}

export default App;
