'use client';

import { useCallback, useRef, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import { useReaderStore } from '@/store/readerStore';
import {
    Highlight,
    OutlineItem,
    ContentBlock,
    StructuredContent,
    TextBlock,
    HeadingBlock,
    MathBlock,
    ListBlock,
    TableBlock,
    FigureBlock,
    ReferencesBlock,
    CodeBlockContent,
    BlockQuoteBlock,
} from '@/types';
import { getTextContext } from '@/lib/utils';

interface BookViewerProps {
    text: string;
    outline: OutlineItem[];
    highlights: Highlight[];
    structuredContent?: StructuredContent | null;
    onTextSelect: (text: string, anchor: {
        exact: string;
        prefix: string;
        suffix: string;
        section_path: string[];
    }) => void;
    scrollToSection?: OutlineItem | null;
}

export function BookViewer({
    text,
    outline,
    highlights,
    structuredContent,
    onTextSelect,
    scrollToSection
}: BookViewerProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const settings = useReaderStore((state) => state.settings);
    const activeHighlightId = useReaderStore((state) => state.activeHighlightId);
    const [currentSection, setCurrentSection] = useState<string>('');

    // Check if we have structured content
    const hasStructuredContent = structuredContent && structuredContent.blocks && structuredContent.blocks.length > 0;

    // Handle text selection
    const handleTextSelection = useCallback(() => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) return;

        const selectedText = selection.toString().trim();
        if (!selectedText || selectedText.length < 3) return;

        const { prefix, suffix } = getTextContext(text, selectedText);

        // Find current section
        const sectionPath: string[] = [];
        const selectionStart = text.indexOf(selectedText);

        for (const item of outline) {
            if (item.start_idx <= selectionStart) {
                sectionPath.push(item.title);
            }
        }

        onTextSelect(selectedText, {
            exact: selectedText,
            prefix,
            suffix,
            section_path: sectionPath.slice(-3)
        });
    }, [text, outline, onTextSelect]);

    // Scroll to active highlight
    useEffect(() => {
        if (activeHighlightId && containerRef.current) {
            const el = containerRef.current.querySelector(`[data-highlight-id="${activeHighlightId}"]`);
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    }, [activeHighlightId]);

    // Scroll to section
    useEffect(() => {
        if (scrollToSection && containerRef.current) {
            const headings = containerRef.current.querySelectorAll('[data-section-title]');
            for (const heading of headings) {
                if (heading.getAttribute('data-section-title')?.toLowerCase().includes(scrollToSection.title.toLowerCase())) {
                    heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    break;
                }
            }
        }
    }, [scrollToSection]);

    // Theme styles
    const getThemeStyles = () => {
        switch (settings.theme) {
            case 'dark':
                return {
                    bg: 'bg-[#1a1a1a]',
                    text: 'text-gray-200',
                    heading: 'text-white',
                    muted: 'text-gray-400',
                    border: 'border-gray-700',
                    highlight: 'bg-yellow-500/30',
                };
            case 'sepia':
                return {
                    bg: 'bg-[#f4ecd8]',
                    text: 'text-[#5c4b37]',
                    heading: 'text-[#3d3225]',
                    muted: 'text-[#8b7355]',
                    border: 'border-[#d4c4a8]',
                    highlight: 'bg-yellow-600/30',
                };
            default:
                return {
                    bg: 'bg-white',
                    text: 'text-gray-800',
                    heading: 'text-gray-900',
                    muted: 'text-gray-500',
                    border: 'border-gray-200',
                    highlight: 'bg-yellow-300/50',
                };
        }
    };

    const theme = getThemeStyles();

    const fontFamilyClass = {
        serif: 'font-serif',
        sans: 'font-sans',
        mono: 'font-mono',
    }[settings.fontFamily || 'serif'];

    const marginClass = {
        compact: 'px-4 sm:px-6',
        normal: 'px-6 sm:px-8 md:px-12',
        wide: 'px-8 sm:px-12 md:px-20',
    }[settings.marginSize || 'normal'];

    // Render highlight overlays on text
    const renderTextWithHighlights = useCallback((content: string, blockId: string) => {
        const bookHighlights = highlights.filter(h => h.mode === 'book');

        const relevantHighlights = bookHighlights
            .map(h => ({
                ...h,
                index: content.indexOf(h.selected_text)
            }))
            .filter(h => h.index !== -1)
            .sort((a, b) => a.index - b.index);

        if (relevantHighlights.length === 0) {
            return content;
        }

        const elements: React.ReactNode[] = [];
        let lastIndex = 0;

        relevantHighlights.forEach((highlight, idx) => {
            if (highlight.index > lastIndex) {
                elements.push(
                    <span key={`${blockId}-text-${idx}`}>
                        {content.slice(lastIndex, highlight.index)}
                    </span>
                );
            }

            elements.push(
                <mark
                    key={`${blockId}-hl-${highlight.id}`}
                    data-highlight-id={highlight.id}
                    className={`
                        rounded px-0.5 cursor-pointer transition-all duration-200
                        ${activeHighlightId === highlight.id
                            ? `${theme.highlight} ring-2 ring-yellow-500 ring-offset-1`
                            : `${theme.highlight} hover:ring-1 hover:ring-yellow-400`
                        }
                    `}
                >
                    {highlight.selected_text}
                </mark>
            );

            lastIndex = highlight.index + highlight.selected_text.length;
        });

        if (lastIndex < content.length) {
            elements.push(
                <span key={`${blockId}-text-end`}>
                    {content.slice(lastIndex)}
                </span>
            );
        }

        return elements;
    }, [highlights, activeHighlightId, theme.highlight]);

    // Render a single content block
    const renderBlock = useCallback((block: ContentBlock, index: number) => {
        const blockId = `block-${index}`;

        switch (block.type) {
            case 'heading': {
                const hb = block as HeadingBlock;
                const Tag = `h${Math.min(hb.level, 6)}` as keyof JSX.IntrinsicElements;
                const sizeClasses = {
                    1: 'text-2xl sm:text-3xl font-bold mt-12 mb-6 pb-3 border-b',
                    2: 'text-xl sm:text-2xl font-semibold mt-10 mb-4',
                    3: 'text-lg sm:text-xl font-medium mt-8 mb-3',
                    4: 'text-base font-medium mt-6 mb-2',
                    5: 'text-sm font-medium mt-4 mb-2',
                    6: 'text-sm font-medium mt-4 mb-2',
                };
                return (
                    <Tag
                        key={blockId}
                        id={hb.id || blockId}
                        data-section-title={hb.content}
                        className={`${sizeClasses[hb.level as 1 | 2 | 3 | 4 | 5 | 6] || sizeClasses[3]} ${theme.heading} ${hb.level === 1 ? theme.border : ''}`}
                    >
                        {renderTextWithHighlights(hb.content, blockId)}
                    </Tag>
                );
            }

            case 'text': {
                const tb = block as TextBlock;
                return (
                    <p
                        key={blockId}
                        className={`mb-5 leading-relaxed text-justify hyphens-auto ${theme.text}`}
                    >
                        {renderTextWithHighlights(tb.content, blockId)}
                    </p>
                );
            }

            case 'math_block': {
                const mb = block as MathBlock;
                if (mb.latex) {
                    return (
                        <div key={blockId} className="math-block">
                            <ReactMarkdown
                                remarkPlugins={[remarkMath]}
                                rehypePlugins={[rehypeKatex]}
                            >
                                {`$$${mb.latex}$$`}
                            </ReactMarkdown>
                        </div>
                    );
                } else if (mb.image_base64) {
                    return (
                        <div key={blockId} className="math-block">
                            <img
                                src={`data:image/png;base64,${mb.image_base64}`}
                                alt={mb.alt_text || 'Equation'}
                                className="equation-image"
                            />
                        </div>
                    );
                } else if (mb.alt_text) {
                    // Fallback: render as text
                    return (
                        <div key={blockId} className={`math-block ${theme.muted} font-mono text-sm`}>
                            {mb.alt_text}
                        </div>
                    );
                }
                return null;
            }

            case 'math_inline': {
                const mi = block as MathBlock;
                if (mi.latex) {
                    return (
                        <span key={blockId} className="math-inline">
                            <ReactMarkdown
                                remarkPlugins={[remarkMath]}
                                rehypePlugins={[rehypeKatex]}
                            >
                                {`$${mi.latex}$`}
                            </ReactMarkdown>
                        </span>
                    );
                }
                return <span key={blockId} className="font-mono">{mi.alt_text}</span>;
            }

            case 'code': {
                const cb = block as CodeBlockContent;
                return (
                    <pre key={blockId} className="code-block">
                        <code>{cb.content}</code>
                    </pre>
                );
            }

            case 'list': {
                const lb = block as ListBlock;
                const ListTag = lb.ordered ? 'ol' : 'ul';
                return (
                    <ListTag
                        key={blockId}
                        className={`book-list ${lb.ordered ? 'list-decimal' : 'list-disc'} ${theme.text}`}
                    >
                        {lb.items.map((item, i) => (
                            <li key={`${blockId}-item-${i}`}>
                                {renderTextWithHighlights(item, `${blockId}-item-${i}`)}
                            </li>
                        ))}
                    </ListTag>
                );
            }

            case 'table': {
                const tb = block as TableBlock;
                return (
                    <div key={blockId} className="overflow-x-auto">
                        <table className={`book-table ${theme.text}`}>
                            {tb.headers.length > 0 && (
                                <thead>
                                    <tr>
                                        {tb.headers.map((h, i) => (
                                            <th key={i}>{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                            )}
                            <tbody>
                                {tb.rows.map((row, ri) => (
                                    <tr key={ri}>
                                        {row.map((cell, ci) => (
                                            <td key={ci}>{cell}</td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {tb.caption && (
                            <p className={`text-sm ${theme.muted} mt-2 text-center italic`}>
                                {tb.caption}
                            </p>
                        )}
                    </div>
                );
            }

            case 'figure': {
                const fb = block as FigureBlock;
                if (!fb.image_base64) return null;
                return (
                    <figure key={blockId} className="figure-block">
                        <img
                            src={`data:image/png;base64,${fb.image_base64}`}
                            alt={fb.caption || 'Figure'}
                        />
                        {(fb.caption || fb.figure_number) && (
                            <figcaption className={theme.muted}>
                                {fb.figure_number && <strong>Figure {fb.figure_number}:</strong>}
                                {fb.caption}
                            </figcaption>
                        )}
                    </figure>
                );
            }

            case 'blockquote': {
                const bq = block as BlockQuoteBlock;
                return (
                    <blockquote key={blockId} className={`book-blockquote ${theme.text}`}>
                        {renderTextWithHighlights(bq.content, blockId)}
                    </blockquote>
                );
            }

            case 'references': {
                const rb = block as ReferencesBlock;
                return (
                    <section key={blockId} className={`references-section ${theme.text}`}>
                        <h2 className={theme.heading}>References</h2>
                        {rb.items.map((ref, i) => (
                            <p key={i} className="reference-item">
                                {ref.number && <span className="font-medium">[{ref.number}]</span>}
                                {' '}{ref.text}
                            </p>
                        ))}
                    </section>
                );
            }

            default:
                return null;
        }
    }, [theme, renderTextWithHighlights]);

    // Fallback: Parse plain text into basic blocks
    const fallbackBlocks = useMemo(() => {
        if (hasStructuredContent) return [];
        if (!text) return [];

        const blocks: ContentBlock[] = [];
        const paragraphs = text.split(/\n\n+/);

        paragraphs.forEach((para, idx) => {
            const trimmed = para.trim();
            if (!trimmed) return;

            // Simple heading detection
            const numberedMatch = trimmed.match(/^(\d+\.(?:\d+\.)*)\s+(.+)$/);
            if (numberedMatch && trimmed.length < 100) {
                const level = numberedMatch[1].split('.').filter(Boolean).length;
                blocks.push({
                    type: 'heading',
                    level: Math.min(level, 4),
                    content: trimmed,
                } as HeadingBlock);
                return;
            }

            // All caps short = heading
            if (trimmed.toUpperCase() === trimmed && trimmed.length < 60 && trimmed.length > 3) {
                blocks.push({
                    type: 'heading',
                    level: 1,
                    content: trimmed,
                } as HeadingBlock);
                return;
            }

            // Common section names
            const commonSections = /^(abstract|introduction|background|methods?|results?|discussion|conclusion|references|acknowledgm?ents?)s?\.?$/i;
            if (commonSections.test(trimmed)) {
                blocks.push({
                    type: 'heading',
                    level: 1,
                    content: trimmed,
                } as HeadingBlock);
                return;
            }

            // Regular paragraph
            blocks.push({
                type: 'text',
                content: trimmed,
            } as TextBlock);
        });

        return blocks;
    }, [text, hasStructuredContent]);

    const blocksToRender = hasStructuredContent ? structuredContent!.blocks : fallbackBlocks;

    if (!text && !hasStructuredContent) {
        return (
            <div className={`flex-1 flex items-center justify-center ${theme.bg}`}>
                <div className="text-center">
                    <svg className="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <p className={theme.muted}>No text content available</p>
                </div>
            </div>
        );
    }

    return (
        <div
            ref={containerRef}
            className={`flex-1 overflow-auto ${theme.bg}`}
            onMouseUp={handleTextSelection}
        >
            <article
                className={`book-content ${fontFamilyClass} mx-auto ${marginClass} py-8 md:py-12`}
                style={{
                    maxWidth: Math.min(settings.pageWidth, 800),
                    fontSize: `${settings.fontSize}px`,
                    lineHeight: settings.lineHeight,
                }}
            >
                {/* Paper metadata header if available */}
                {hasStructuredContent && structuredContent!.metadata?.title && (
                    <header className="mb-12 text-center">
                        <h1 className={`text-3xl sm:text-4xl font-bold ${theme.heading} mb-4`}>
                            {structuredContent!.metadata.title}
                        </h1>
                        {structuredContent!.metadata.author && (
                            <p className={`${theme.muted} text-lg`}>
                                {structuredContent!.metadata.author}
                            </p>
                        )}
                    </header>
                )}

                {/* Render all blocks */}
                {blocksToRender.map((block, index) => renderBlock(block, index))}

                {/* Bottom spacing */}
                <div className="h-32" />
            </article>
        </div>
    );
}