// apps/web/src/components/reader/BookViewer.tsx
'use client';

import { useCallback, useRef, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { useReaderStore } from '@/store/readerStore';
import { BookContent, BookSection, Highlight, Explanation } from '@/types';
import { Info, FileText, Sparkles, AlertTriangle } from 'lucide-react';

interface BookViewerProps {
    paperId: string;
    bookContent: BookContent;
    pageCount: number;
    highlights: Highlight[];
    explanations: Explanation[];
    onTextSelect: (text: string, sectionId: string, pdfPage: number) => void;
    onSectionVisible: (sectionId: string, pdfPages: number[]) => void;
    onFigureClick: (figureId: string, pdfPage: number) => void;
    onHighlightClick: (highlightId: string, position: { x: number; y: number }) => void;
    scrollToSectionId?: string | null;
}

// Normalize text for matching
function normalizeText(text: string): string {
    return text
        .replace(/\s+/g, ' ')
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .trim();
}

// Highlight text in DOM
function highlightTextInElement(
    container: HTMLElement,
    searchText: string,
    highlightId: string,
    isActive: boolean,
    expCount: number,
    theme: string
): boolean {
    const normalizedSearch = normalizeText(searchText);
    if (!normalizedSearch || normalizedSearch.length < 3) return false;

    // Theme colors
    const colors = {
        light: {
            bg: isActive ? 'rgba(250, 204, 21, 0.6)' : 'rgba(254, 240, 138, 0.5)',
            border: isActive ? '2px solid rgba(234, 179, 8, 0.8)' : '1px solid rgba(254, 240, 138, 0.3)',
            badge: isActive ? '#3b82f6' : '#eab308'
        },
        dark: {
            bg: isActive ? 'rgba(234, 179, 8, 0.4)' : 'rgba(250, 204, 21, 0.25)',
            border: isActive ? '2px solid rgba(250, 204, 21, 0.6)' : '1px solid rgba(234, 179, 8, 0.3)',
            badge: isActive ? '#60a5fa' : '#facc15'
        },
        sepia: {
            bg: isActive ? 'rgba(217, 119, 6, 0.4)' : 'rgba(245, 158, 11, 0.3)',
            border: isActive ? '2px solid rgba(180, 83, 9, 0.6)' : '1px solid rgba(217, 119, 6, 0.3)',
            badge: isActive ? '#0369a1' : '#b45309'
        }
    };

    const themeColors = colors[theme as keyof typeof colors] || colors.light;

    // Walk text nodes
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
            const parent = node.parentElement;
            if (parent?.classList.contains('highlight-mark') || parent?.classList.contains('highlight-badge')) {
                return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
        }
    });

    const textNodes: Text[] = [];
    let node: Text | null;
    while ((node = walker.nextNode() as Text)) textNodes.push(node);

    // Build combined text
    let combinedText = '';
    const nodeMap: Array<{ node: Text; start: number; end: number }> = [];

    for (const textNode of textNodes) {
        const content = textNode.textContent || '';
        const start = combinedText.length;
        combinedText += content;
        nodeMap.push({ node: textNode, start, end: combinedText.length });
    }

    // Find match with normalization
    let actualStart = -1;
    let actualEnd = -1;
    let normalized = '';

    for (let i = 0; i < combinedText.length; i++) {
        const char = combinedText[i];
        if (!/\s/.test(char) || (normalized.length > 0 && !/\s/.test(normalized[normalized.length - 1]))) {
            normalized += /\s/.test(char) ? ' ' : char;
        }

        const trimmedNorm = normalized.trim();
        const targetTrim = normalizedSearch.trim();

        if (targetTrim.startsWith(trimmedNorm)) {
            if (actualStart === -1) actualStart = i;
            actualEnd = i + 1;

            if (trimmedNorm === targetTrim) break;
        } else if (actualStart !== -1) {
            actualStart = -1;
            normalized = '';
        }
    }

    if (actualStart === -1) return false;

    // Apply highlight to affected nodes
    for (const { node, start, end } of nodeMap) {
        if (actualStart >= end || actualEnd <= start) continue;

        const content = node.textContent || '';
        const nodeStart = Math.max(0, actualStart - start);
        const nodeEnd = Math.min(content.length, actualEnd - start);
        if (nodeStart >= nodeEnd) continue;

        const before = content.slice(0, nodeStart);
        const match = content.slice(nodeStart, nodeEnd);
        const after = content.slice(nodeEnd);

        const parent = node.parentNode;
        if (!parent) continue;

        const wrapper = document.createElement('span');
        wrapper.className = 'highlight-wrapper';
        wrapper.innerHTML = `<mark data-highlight-id="${highlightId}" class="highlight-mark ${isActive ? 'active' : ''}" style="
            background: ${themeColors.bg};
            padding: 2px 4px;
            border-radius: 3px;
            cursor: pointer;
            transition: all 0.2s;
            border: ${themeColors.border};
            ${isActive ? 'box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15); font-weight: 500;' : ''}
        ">${match}</mark><span data-highlight-id="${highlightId}" class="highlight-badge" style="
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-width: 20px;
            height: 20px;
            padding: 0 5px;
            margin-left: 4px;
            border-radius: 10px;
            background: ${themeColors.badge};
            color: white;
            font-size: 11px;
            font-weight: 700;
            cursor: pointer;
            vertical-align: middle;
            transition: transform 0.15s;
            ${isActive ? 'transform: scale(1.15);' : ''}
        ">${expCount || '💬'}</span>`;

        if (before) parent.insertBefore(document.createTextNode(before), node);
        parent.insertBefore(wrapper, node);
        if (after) parent.insertBefore(document.createTextNode(after), node);
        parent.removeChild(node);

        return true;
    }

    return false;
}

// Mermaid
function MermaidDiagram({ chart }: { chart: string }) {
    const [svg, setSvg] = useState('');
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            if (!chart?.trim()) { setFailed(true); return; }
            try {
                const m = (await import('mermaid')).default;
                m.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'loose' });
                const { svg: s } = await Promise.race([
                    m.render(`m-${Math.random().toString(36).slice(2)}`, chart.trim()),
                    new Promise<never>((_, rej) => setTimeout(() => rej('timeout'), 4000))
                ]);
                if (!cancelled) setSvg(s);
            } catch { if (!cancelled) setFailed(true); }
        })();
        return () => { cancelled = true; };
    }, [chart]);

    if (failed) return <pre className="my-4 p-3 bg-gray-100 dark:bg-gray-800 rounded text-xs overflow-auto">{chart}</pre>;
    if (!svg) return <div className="my-4 p-4 text-center text-gray-400">Loading...</div>;
    return <div className="my-6 flex justify-center" dangerouslySetInnerHTML={{ __html: svg }} />;
}

export function BookViewer(props: BookViewerProps) {
    const {
        bookContent,
        highlights,
        explanations,
        onTextSelect,
        onSectionVisible,
        onFigureClick,
        onHighlightClick,
        scrollToSectionId,
    } = props;

    const containerRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const sectionRefs = useRef<Map<string, HTMLElement>>(new Map());
    const [highlightKey, setHighlightKey] = useState(0);

    const settings = useReaderStore((s) => s.settings);
    const currentSectionId = useReaderStore((s) => s.currentSectionId);
    const activeHighlightId = useReaderStore((s) => s.activeHighlightId);
    const inlineExplanation = useReaderStore((s) => s.inlineExplanation);

    const sections = useMemo(() => bookContent?.sections || [], [bookContent]);

    const getExplanationCount = useCallback((hId: string) =>
        explanations.filter((e) => e.highlight_id === hId).length, [explanations]);

    // Apply highlights
    useEffect(() => {
        if (!contentRef.current || highlights.length === 0) return;

        console.log(`[Highlights] Applying ${highlights.length} highlights`);

        // Clear
        contentRef.current.querySelectorAll('.highlight-wrapper').forEach((el) => {
            const p = el.parentNode;
            if (p) {
                p.replaceChild(document.createTextNode(el.querySelector('mark')?.textContent || ''), el);
                p.normalize();
            }
        });

        const bookHighlights = highlights.filter((h) => h.mode === 'book');

        const timer = setTimeout(() => {
            let count = 0;
            bookHighlights.forEach((h) => {
                const isActive = activeHighlightId === h.id || inlineExplanation.highlightId === h.id;
                const expCount = getExplanationCount(h.id);
                if (highlightTextInElement(contentRef.current!, h.selected_text, h.id, isActive, expCount, settings.theme)) {
                    count++;
                }
            });
            console.log(`[Highlights] Applied ${count}/${bookHighlights.length}`);
        }, 150);

        return () => clearTimeout(timer);
    }, [highlights, activeHighlightId, inlineExplanation.highlightId, explanations, highlightKey, settings.theme, getExplanationCount]);

    // Re-apply when explanation count changes
    useEffect(() => {
        setHighlightKey((k) => k + 1);
    }, [explanations.length]);

    // Click handler
    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            const t = e.target as HTMLElement;
            if (t.hasAttribute('data-highlight-id')) {
                e.preventDefault();
                e.stopPropagation();
                const hId = t.getAttribute('data-highlight-id');
                if (hId) {
                    const rect = t.getBoundingClientRect();
                    onHighlightClick(hId, { x: rect.right, y: rect.bottom });
                }
            }
        };
        contentRef.current?.addEventListener('click', handleClick);
        return () => contentRef.current?.removeEventListener('click', handleClick);
    }, [onHighlightClick]);

    // Section observer
    useEffect(() => {
        if (!containerRef.current || sections.length === 0) return;

        const obs = new IntersectionObserver(
            (entries) => {
                const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio);
                if (vis.length > 0) {
                    const sId = vis[0].target.getAttribute('data-section-id');
                    const pdfPages = vis[0].target.getAttribute('data-pdf-pages');
                    if (sId) onSectionVisible(sId, pdfPages ? JSON.parse(pdfPages) : [0]);
                }
            },
            { root: containerRef.current, threshold: [0, 0.1, 0.25, 0.5], rootMargin: '-15% 0px -65% 0px' }
        );

        setTimeout(() => sectionRefs.current.forEach((el) => obs.observe(el)), 150);
        return () => obs.disconnect();
    }, [sections, onSectionVisible]);

    // Scroll to section
    useEffect(() => {
        if (scrollToSectionId) {
            sectionRefs.current.get(scrollToSectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }, [scrollToSectionId]);

    // Text selection
    const handleMouseUp = useCallback(() => {
        if (inlineExplanation.isOpen) return;

        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) return;

        const text = sel.toString().trim();
        if (!text || text.length < 3) return;

        let sectionId = '', pdfPage = 0;
        let el = sel.anchorNode?.nodeType === Node.TEXT_NODE ? sel.anchorNode.parentElement : sel.anchorNode as HTMLElement;

        while (el && el !== containerRef.current) {
            const id = el.getAttribute('data-section-id');
            if (id) {
                sectionId = id;
                try { pdfPage = JSON.parse(el.getAttribute('data-pdf-pages') || '[0]')[0]; } catch { }
                break;
            }
            el = el.parentElement;
        }

        onTextSelect(text, sectionId, pdfPage);
    }, [onTextSelect, inlineExplanation.isOpen]);

    // Theme
    const theme = useMemo(() => ({
        dark: { bg: 'bg-[#1a1a1a]', text: 'text-gray-200', heading: 'text-white', muted: 'text-gray-400', border: 'border-gray-700', card: 'bg-gray-800/50', code: 'bg-gray-800' },
        sepia: { bg: 'bg-[#f4ecd8]', text: 'text-[#5c4b37]', heading: 'text-[#3d3225]', muted: 'text-[#8b7355]', border: 'border-[#d4c4a8]', card: 'bg-[#efe6d5]', code: 'bg-[#e8dcc8]' },
        light: { bg: 'bg-white', text: 'text-gray-700', heading: 'text-gray-900', muted: 'text-gray-500', border: 'border-gray-200', card: 'bg-gray-50', code: 'bg-gray-100' },
    }[settings.theme] || { bg: 'bg-white', text: 'text-gray-700', heading: 'text-gray-900', muted: 'text-gray-500', border: 'border-gray-200', card: 'bg-gray-50', code: 'bg-gray-100' }), [settings.theme]);

    const fontClass = { serif: 'font-serif', sans: 'font-sans', mono: 'font-mono' }[settings.fontFamily || 'serif'];

    // Markdown
    const mdComponents = useMemo(() => ({
        code({ inline, className, children }: any) {
            const lang = /language-(\w+)/.exec(className || '')?.[1];
            const code = String(children).replace(/\n$/, '');
            if (!inline && lang === 'mermaid') return <MermaidDiagram chart={code} />;
            if (inline) return <code className={`px-1.5 py-0.5 rounded ${theme.code} text-sm font-mono`}>{children}</code>;
            return <pre className={`p-4 rounded-lg overflow-x-auto ${theme.code} my-4`}><code className="text-sm font-mono">{children}</code></pre>;
        },
        p: ({ children }: any) => <p className={`mb-4 leading-relaxed ${theme.text}`}>{children}</p>,
        h1: ({ children }: any) => <h1 className={`text-2xl font-bold ${theme.heading} mt-8 mb-4`}>{children}</h1>,
        h2: ({ children }: any) => <h2 className={`text-xl font-semibold ${theme.heading} mt-6 mb-3`}>{children}</h2>,
        h3: ({ children }: any) => <h3 className={`text-lg font-medium ${theme.heading} mt-5 mb-2`}>{children}</h3>,
        ul: ({ children }: any) => <ul className={`list-disc ml-6 mb-4 space-y-2 ${theme.text}`}>{children}</ul>,
        ol: ({ children }: any) => <ol className={`list-decimal ml-6 mb-4 space-y-2 ${theme.text}`}>{children}</ol>,
        blockquote: ({ children }: any) => <blockquote className={`border-l-4 ${theme.border} pl-4 my-4 italic ${theme.muted}`}>{children}</blockquote>,
    }), [theme]);

    const renderSection = (section: BookSection, index: number) => {
        const isActive = currentSectionId === section.id;
        const pdfPages = section.pdf_pages || [0];
        const sectionId = section.id || `section-${index}`;

        return (
            <section
                key={sectionId}
                ref={(el) => { if (el) sectionRefs.current.set(sectionId, el); }}
                data-section-id={sectionId}
                data-pdf-pages={JSON.stringify(pdfPages)}
                className={`mb-8 scroll-mt-20 transition-all rounded-lg ${isActive ? `ring-2 ring-blue-400/50 ${theme.card} p-5 -mx-2` : 'p-2'}`}
            >
                <div className={`flex items-center gap-3 mb-4 pb-3 border-b ${theme.border}`}>
                    <h2 className={`font-semibold ${theme.heading} flex-1`} style={{ fontSize: `${1.4 - ((section.level || 1) - 1) * 0.1}rem` }}>
                        {section.title || `Section ${index + 1}`}
                    </h2>
                    <button onClick={() => onFigureClick('', pdfPages[0])} className={`text-xs ${theme.muted} ${theme.card} px-2 py-1 rounded-md hover:bg-blue-100 dark:hover:bg-blue-900/30 border ${theme.border} flex items-center gap-1`}>
                        <FileText className="w-3 h-3" /> p.{pdfPages[0] + 1}
                    </button>
                </div>
                <div className="section-content">
                    <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]} components={mdComponents}>
                        {section.content || ''}
                    </ReactMarkdown>
                </div>
            </section>
        );
    };

    if (!bookContent || sections.length === 0) {
        return <div className={`flex-1 flex items-center justify-center ${theme.bg}`}>
            <div className="text-center p-8"><AlertTriangle className="w-12 h-12 text-yellow-500 mx-auto mb-4" />
                <h2 className={`text-lg font-semibold ${theme.heading} mb-2`}>No Content</h2></div>
        </div>;
    }

    return (
        <div ref={containerRef} className={`flex-1 overflow-auto ${theme.bg}`} onMouseUp={handleMouseUp}>
            <article ref={contentRef} className={`book-content ${fontClass} mx-auto px-6 md:px-12 py-8`} style={{ maxWidth: settings.pageWidth || 720, fontSize: settings.fontSize || 18, lineHeight: settings.lineHeight || 1.8 }}>
                <header className="mb-10 text-center">
                    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full ${theme.card} ${theme.muted} text-sm mb-4 border ${theme.border}`}>
                        <Sparkles className="w-4 h-4 text-blue-500" /> AI-Generated
                    </div>
                    <h1 className={`text-2xl md:text-3xl font-bold ${theme.heading} mb-4`}>{bookContent.title || 'Untitled'}</h1>
                    {bookContent.authors && <p className={theme.muted}>{bookContent.authors}</p>}
                </header>

                {bookContent.tldr && (
                    <div className={`p-5 rounded-xl ${theme.card} border ${theme.border} mb-10`}>
                        <div className="flex items-center gap-2 mb-2"><Info className="w-5 h-5 text-blue-500" /><h2 className={`font-semibold ${theme.heading}`}>TL;DR</h2></div>
                        <p className={`${theme.text} leading-relaxed`}>{bookContent.tldr}</p>
                    </div>
                )}

                {sections.map((s, i) => renderSection(s, i))}

                <footer className={`mt-12 pt-6 border-t ${theme.border} text-center`}>
                    <p className={`text-sm ${theme.muted}`}>💡 Select text to ask AI. Click highlights to view explanations.</p>
                </footer>
                <div className="h-24" />
            </article>
        </div>
    );
}