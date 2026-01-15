'use client';

import { useCallback, useRef, useEffect, useMemo, useState } from 'react';
import { useReaderStore } from '@/store/readerStore';
import { Highlight, OutlineItem } from '@/types';
import { getTextContext } from '@/lib/utils';

interface BookViewerProps {
    text: string;
    outline: OutlineItem[];
    highlights: Highlight[];
    onTextSelect: (text: string, anchor: {
        exact: string;
        prefix: string;
        suffix: string;
        section_path: string[];
    }) => void;
    scrollToSection?: OutlineItem | null;
}

interface ContentBlock {
    id: string;
    type: 'heading' | 'paragraph' | 'list-item' | 'quote';
    content: string;
    level?: number;
}

export function BookViewer({
    text,
    outline,
    highlights,
    onTextSelect,
    scrollToSection
}: BookViewerProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const settings = useReaderStore((state) => state.settings);
    const activeHighlightId = useReaderStore((state) => state.activeHighlightId);
    const [currentSection, setCurrentSection] = useState<string>('');

    // Parse and format the text into readable blocks
    const formattedContent = useMemo((): ContentBlock[] => {
        if (!text) return [];

        const blocks: ContentBlock[] = [];

        // Split into paragraphs (double newline or more)
        const rawParagraphs = text.split(/\n\n+/);

        rawParagraphs.forEach((para, idx) => {
            const trimmed = para.trim();
            if (!trimmed) return;

            // Clean up the paragraph
            let cleaned = trimmed
                // Fix multiple spaces
                .replace(/\s+/g, ' ')
                // Fix common OCR/extraction issues
                .replace(/([a-z])([A-Z])/g, '$1 $2') // camelCase -> camel Case (often missing spaces)
                .trim();

            // Skip very short meaningless content
            if (cleaned.length < 3) return;

            // Detect if this is a heading
            const isHeading = detectHeading(cleaned, outline);

            if (isHeading) {
                blocks.push({
                    id: `heading-${idx}`,
                    type: 'heading',
                    content: cleaned,
                    level: isHeading.level,
                });
            } else if (cleaned.startsWith('•') || cleaned.startsWith('-') || /^\d+\.\s/.test(cleaned)) {
                // List item
                blocks.push({
                    id: `list-${idx}`,
                    type: 'list-item',
                    content: cleaned.replace(/^[•\-]\s*/, '').replace(/^\d+\.\s*/, ''),
                });
            } else {
                // Regular paragraph
                blocks.push({
                    id: `para-${idx}`,
                    type: 'paragraph',
                    content: cleaned,
                });
            }
        });

        return blocks;
    }, [text, outline]);

    // Detect if text is a heading
    function detectHeading(text: string, outline: OutlineItem[]): { level: number } | null {
        // Check against outline
        const matchInOutline = outline.find(item =>
            text.toLowerCase().includes(item.title.toLowerCase()) ||
            item.title.toLowerCase().includes(text.toLowerCase())
        );

        if (matchInOutline) {
            return { level: matchInOutline.level };
        }

        // Check common patterns
        // Numbered: "1. Introduction", "2.1 Background"
        if (/^\d+\.(\d+\.)*\s+[A-Z]/.test(text) && text.length < 80) {
            const dots = (text.match(/\./g) || []).length;
            return { level: Math.min(dots, 3) };
        }

        // All caps (but not too long)
        if (/^[A-Z][A-Z\s]{2,50}$/.test(text)) {
            return { level: 1 };
        }

        // Common section names
        if (/^(Abstract|Introduction|Background|Methods?|Results?|Discussion|Conclusions?|References|Acknowledgm?ents?)$/i.test(text)) {
            return { level: 1 };
        }

        return null;
    }

    // Render text with highlights
    const renderWithHighlights = useCallback((content: string, blockId: string) => {
        const bookHighlights = highlights.filter(h => h.mode === 'book');

        // Find highlights in this content
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
            // Text before highlight
            if (highlight.index > lastIndex) {
                elements.push(
                    <span key={`${blockId}-text-${idx}`}>
                        {content.slice(lastIndex, highlight.index)}
                    </span>
                );
            }

            // Highlighted text
            elements.push(
                <mark
                    key={`${blockId}-hl-${highlight.id}`}
                    data-highlight-id={highlight.id}
                    className={`
            rounded px-0.5 cursor-pointer transition-all duration-200
            ${activeHighlightId === highlight.id
                            ? 'bg-yellow-400 ring-2 ring-yellow-500 ring-offset-1'
                            : 'bg-yellow-200 hover:bg-yellow-300'
                        }
          `}
                >
                    {highlight.selected_text}
                </mark>
            );

            lastIndex = highlight.index + highlight.selected_text.length;
        });

        // Remaining text
        if (lastIndex < content.length) {
            elements.push(
                <span key={`${blockId}-text-end`}>
                    {content.slice(lastIndex)}
                </span>
            );
        }

        return elements;
    }, [highlights, activeHighlightId]);

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
                    bg: 'bg-gray-900',
                    text: 'text-gray-100',
                    heading: 'text-white',
                    muted: 'text-gray-400',
                    border: 'border-gray-700',
                };
            case 'sepia':
                return {
                    bg: 'bg-[#f4ecd8]',
                    text: 'text-[#5c4b37]',
                    heading: 'text-[#3d3225]',
                    muted: 'text-[#8b7355]',
                    border: 'border-[#d4c4a8]',
                };
            default:
                return {
                    bg: 'bg-white',
                    text: 'text-gray-800',
                    heading: 'text-gray-900',
                    muted: 'text-gray-500',
                    border: 'border-gray-200',
                };
        }
    };

    const theme = getThemeStyles();

    if (!text) {
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
                className="mx-auto px-6 sm:px-8 md:px-12 py-8 md:py-12"
                style={{
                    maxWidth: Math.min(settings.pageWidth, 800),
                    fontSize: `${settings.fontSize}px`,
                    lineHeight: settings.lineHeight,
                }}
            >
                {/* Reading progress indicator could go here */}

                {formattedContent.map((block, index) => {
                    switch (block.type) {
                        case 'heading':
                            const HeadingTag = block.level === 1 ? 'h2' : block.level === 2 ? 'h3' : 'h4';
                            const headingClasses = {
                                1: `text-2xl sm:text-3xl font-bold mt-12 mb-6 pb-3 border-b ${theme.border} ${theme.heading}`,
                                2: `text-xl sm:text-2xl font-semibold mt-10 mb-4 ${theme.heading}`,
                                3: `text-lg sm:text-xl font-medium mt-8 mb-3 ${theme.heading}`,
                            };

                            return (
                                <HeadingTag
                                    key={block.id}
                                    id={block.id}
                                    data-section-title={block.content}
                                    className={headingClasses[block.level as 1 | 2 | 3] || headingClasses[3]}
                                >
                                    {renderWithHighlights(block.content, block.id)}
                                </HeadingTag>
                            );

                        case 'list-item':
                            return (
                                <div
                                    key={block.id}
                                    className={`flex gap-3 mb-2 pl-4 ${theme.text}`}
                                >
                                    <span className={theme.muted}>•</span>
                                    <span>{renderWithHighlights(block.content, block.id)}</span>
                                </div>
                            );

                        case 'paragraph':
                        default:
                            return (
                                <p
                                    key={block.id}
                                    className={`mb-5 leading-relaxed text-justify hyphens-auto ${theme.text}`}
                                    style={{
                                        textIndent: index > 0 && formattedContent[index - 1]?.type === 'paragraph' ? '1.5em' : 0
                                    }}
                                >
                                    {renderWithHighlights(block.content, block.id)}
                                </p>
                            );
                    }
                })}

                {/* Bottom spacing */}
                <div className="h-32" />
            </article>
        </div>
    );
}