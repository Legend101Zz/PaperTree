// apps/web/src/app/paper/[id]/read/page.tsx
'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { ReaderToolbar } from '@/components/reader/ReaderToolbar';
import { PDFViewer } from '@/components/reader/PDFViewer';
import { BookViewer } from '@/components/reader/BookViewer';
import { SmartOutlinePanel } from '@/components/reader/SmartOutlinePanel';
import { HighlightPopup } from '@/components/reader/HighlightPopup';
import { PDFMinimap } from '@/components/reader/PDFMinimap';
import { FigureViewer } from '@/components/reader/FigureViewer';
import { InlineExplanation } from '@/components/reader/InlineExplanation';
import { HighlightsPanel } from '@/components/reader/HighlightsPanel';
import { useReaderStore } from '@/store/readerStore';
import { papersApi, highlightsApi, explanationsApi } from '@/lib/api';
import { PaperDetail, Highlight, Explanation } from '@/types';
import { Sparkles, Loader2, PanelLeftClose, PanelLeft, PanelRightClose, PanelRight } from 'lucide-react';

export default function ReaderPage() {
    const params = useParams();
    const paperId = params.id as string;
    const queryClient = useQueryClient();

    // Store state
    const settings = useReaderStore((s) => s.settings);
    const highlights = useReaderStore((s) => s.highlights);
    const explanations = useReaderStore((s) => s.explanations);
    const selectedText = useReaderStore((s) => s.selectedText);
    const selectionPosition = useReaderStore((s) => s.selectionPosition);
    const inlineExplanation = useReaderStore((s) => s.inlineExplanation);
    const sidebarCollapsed = useReaderStore((s) => s.sidebarCollapsed);
    const minimapCollapsed = useReaderStore((s) => s.minimapCollapsed);

    // Store actions
    const setHighlights = useReaderStore((s) => s.setHighlights);
    const setExplanations = useReaderStore((s) => s.setExplanations);
    const addHighlight = useReaderStore((s) => s.addHighlight);
    const addExplanation = useReaderStore((s) => s.addExplanation);
    const setSelection = useReaderStore((s) => s.setSelection);
    const clearSelection = useReaderStore((s) => s.clearSelection);
    const updateExplanation = useReaderStore((s) => s.updateExplanation);
    const setCurrentSection = useReaderStore((s) => s.setCurrentSection);
    const setMode = useReaderStore((s) => s.setMode);
    const resetReaderState = useReaderStore((s) => s.resetReaderState);
    const openFigureViewer = useReaderStore((s) => s.openFigureViewer);
    const openInlineExplanation = useReaderStore((s) => s.openInlineExplanation);
    const closeInlineExplanation = useReaderStore((s) => s.closeInlineExplanation);
    const setSidebarCollapsed = useReaderStore((s) => s.setSidebarCollapsed);
    const setMinimapCollapsed = useReaderStore((s) => s.setMinimapCollapsed);

    const [pendingHighlight, setPendingHighlight] = useState<any>(null);
    const [scrollToSectionId, setScrollToSectionId] = useState<string | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);

    // Reset on mount
    useEffect(() => {
        resetReaderState();
    }, [paperId, resetReaderState]);

    // Fetch paper
    const { data: paper, isLoading, refetch: refetchPaper } = useQuery({
        queryKey: ['paper', paperId],
        queryFn: () => papersApi.get(paperId) as Promise<PaperDetail>,
        enabled: !!paperId,
    });

    // Fetch highlights
    const { data: fetchedHighlights, refetch: refetchHighlights } = useQuery({
        queryKey: ['highlights', paperId],
        queryFn: async () => {
            const result = await highlightsApi.list(paperId);
            return result as Highlight[];
        },
        enabled: !!paperId,
        refetchOnWindowFocus: true,
    });

    // Fetch explanations
    const { data: fetchedExplanations, refetch: refetchExplanations } = useQuery({
        queryKey: ['explanations', paperId],
        queryFn: async () => {
            const result = await explanationsApi.list(paperId);
            return result as Explanation[];
        },
        enabled: !!paperId,
        refetchInterval: inlineExplanation.isOpen ? 2000 : false,
    });

    // Sync fetched data to store
    useEffect(() => {
        if (fetchedHighlights) setHighlights(fetchedHighlights);
    }, [fetchedHighlights, setHighlights]);

    useEffect(() => {
        if (fetchedExplanations) setExplanations(fetchedExplanations);
    }, [fetchedExplanations, setExplanations]);

    // Mutations
    const createHighlightMutation = useMutation({
        mutationFn: (data: any) => highlightsApi.create(paperId, data),
        onSuccess: (newHighlight) => {
            addHighlight(newHighlight);
            refetchHighlights();
        },
    });

    const createExplanationMutation = useMutation({
        mutationFn: (data: any) => explanationsApi.create(paperId, data),
        onSuccess: (newExplanation) => {
            addExplanation(newExplanation);
            refetchExplanations();
        },
    });

    const updateExplanationMutation = useMutation({
        mutationFn: ({ id, data }: { id: string; data: any }) => explanationsApi.update(id, data),
        onSuccess: (updated) => updateExplanation(updated.id, updated),
    });

    const deleteHighlightMutation = useMutation({
        mutationFn: (highlightId: string) => highlightsApi.delete(highlightId),
        onSuccess: (_, highlightId) => {
            setHighlights(highlights.filter((h) => h.id !== highlightId));
            setExplanations(explanations.filter((e) => e.highlight_id !== highlightId));
            refetchHighlights();
            refetchExplanations();
        },
    });

    // Generate book
    const handleGenerateBook = async () => {
        setIsGenerating(true);
        try {
            await papersApi.generateBook(paperId);
            await refetchPaper();
            setMode('book');
        } catch (error) {
            console.error('Failed to generate:', error);
            alert('Failed to generate. Please try again.');
        } finally {
            setIsGenerating(false);
        }
    };

    // Handlers
    const handleSectionVisible = useCallback((sectionId: string, pdfPages: number[]) => {
        setCurrentSection(sectionId, pdfPages[0] ?? 0);
    }, [setCurrentSection]);

    const handleFigureClick = useCallback((figureId: string, pdfPage: number) => {
        openFigureViewer(pdfPage);
    }, [openFigureViewer]);

    const handleOutlineClick = useCallback((sectionId: string) => {
        setScrollToSectionId(sectionId);
        setTimeout(() => setScrollToSectionId(null), 100);
    }, []);

    const handlePdfPageClick = useCallback((page: number) => {
        setCurrentSection(null, page);
    }, [setCurrentSection]);

    const handleSwitchToPDF = useCallback((page: number) => {
        closeInlineExplanation();
        setCurrentSection(null, page);
        setMode('pdf');
    }, [setMode, setCurrentSection, closeInlineExplanation]);

    const handleBookTextSelect = useCallback((text: string, sectionId: string, pdfPage: number) => {
        if (!text.trim() || inlineExplanation.isOpen) return;

        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return;

        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();

        setSelection(text, { x: rect.right, y: rect.top });
        setPendingHighlight({
            mode: 'book',
            selected_text: text,
            section_id: sectionId,
            page_number: pdfPage + 1,
        });
    }, [setSelection, inlineExplanation.isOpen]);

    const handlePDFTextSelect = useCallback((text: string, pageNumber: number, rects: any[]) => {
        if (!text.trim()) return;
        const rect = rects[0];
        setSelection(text, { x: rect.x + rect.w, y: rect.y });
        setPendingHighlight({
            mode: 'pdf',
            selected_text: text,
            page_number: pageNumber,
            rects: rects.map((r) => ({
                x: r.x / window.innerWidth,
                y: r.y / window.innerHeight,
                w: r.w / window.innerWidth,
                h: r.h / window.innerHeight,
            })),
        });
    }, [setSelection]);

    const handleHighlightClick = useCallback((highlightId: string, position: { x: number; y: number }) => {
        window.getSelection()?.removeAllRanges();
        clearSelection();
        setPendingHighlight(null);
        openInlineExplanation(highlightId, position);
    }, [openInlineExplanation, clearSelection]);

    const handleAskAI = useCallback(async (question: string) => {
        if (!pendingHighlight) return;

        try {
            const highlight = await createHighlightMutation.mutateAsync(pendingHighlight);

            const selection = window.getSelection();
            let position = { x: window.innerWidth / 2, y: 200 };
            if (selection && selection.rangeCount > 0) {
                const rect = selection.getRangeAt(0).getBoundingClientRect();
                position = { x: rect.right, y: rect.bottom };
            }

            clearSelection();
            setPendingHighlight(null);
            openInlineExplanation(highlight.id, position);

            await createExplanationMutation.mutateAsync({
                highlight_id: highlight.id,
                question,
            });
        } catch (error) {
            console.error('Failed:', error);
        }
    }, [pendingHighlight, createHighlightMutation, createExplanationMutation, clearSelection, openInlineExplanation]);

    const handleFollowUp = useCallback(async (parentId: string, question: string) => {
        const parent = explanations.find((e) => e.id === parentId);
        if (!parent) return;

        await createExplanationMutation.mutateAsync({
            highlight_id: parent.highlight_id,
            question,
            parent_id: parentId,
        });
    }, [explanations, createExplanationMutation]);

    const handleGoToPdf = useCallback((page: number) => {
        closeInlineExplanation();
        setCurrentSection(null, page);
        setMode('pdf');
    }, [closeInlineExplanation, setCurrentSection, setMode]);

    const handleDeleteHighlight = useCallback((highlightId: string) => {
        if (confirm('Delete this highlight and all its explanations?')) {
            deleteHighlightMutation.mutate(highlightId);
        }
    }, [deleteHighlightMutation]);

    const handleExportToCanvas = useCallback((highlightIds: string[]) => {
        console.log('Export to canvas:', highlightIds);
        alert(`Export ${highlightIds.length} highlights to Canvas - Coming soon!`);
    }, []);

    // Apply theme
    useEffect(() => {
        const root = document.documentElement;
        root.classList.remove('dark', 'sepia');
        if (settings.theme === 'dark') root.classList.add('dark');
        else if (settings.theme === 'sepia') root.classList.add('sepia');
    }, [settings.theme]);

    if (isLoading || !paper) {
        return (
            <AuthGuard>
                <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
                    <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                </div>
            </AuthGuard>
        );
    }

    const hasBookContent = !!paper.book_content;
    const pdfUrl = papersApi.getFileUrl(paperId);
    const showMinimap = settings.mode === 'book' && hasBookContent && paper.page_count && !minimapCollapsed;

    return (
        <AuthGuard>
            <div className="h-screen flex flex-col bg-gray-50 dark:bg-gray-950 overflow-hidden">
                <ReaderToolbar
                    paperId={paperId}
                    paperTitle={paper.title}
                    hasBookContent={hasBookContent}
                    onGenerateBook={handleGenerateBook}
                    isGenerating={isGenerating}
                />

                {/* Main content area - proper flex layout */}
                <div className="flex-1 flex overflow-hidden relative">

                    {/* LEFT: Collapsible Sidebar/Outline */}
                    <aside
                        className={`
                            flex-shrink-0 overflow-hidden
                            border-r border-gray-200 dark:border-gray-700 
                            bg-white dark:bg-gray-900 
                            transition-all duration-300 ease-in-out
                        `}
                        style={{ width: sidebarCollapsed ? 0 : 256 }}
                    >
                        <div className="w-64 h-full overflow-y-auto overscroll-contain">
                            <SmartOutlinePanel
                                outline={paper.smart_outline || []}
                                onSectionClick={handleOutlineClick}
                                onPdfPageClick={handlePdfPageClick}
                            />
                        </div>
                    </aside>

                    {/* Sidebar Toggle */}
                    <button
                        onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                        className={`
                            absolute z-20 top-1/2 -translate-y-1/2
                            p-2 rounded-r-lg 
                            bg-white dark:bg-gray-800 
                            border border-l-0 border-gray-200 dark:border-gray-700
                            shadow-md hover:bg-gray-50 dark:hover:bg-gray-700
                            transition-all duration-300
                        `}
                        style={{ left: sidebarCollapsed ? 0 : 256 }}
                        title={sidebarCollapsed ? 'Show outline' : 'Hide outline'}
                    >
                        {sidebarCollapsed ? (
                            <PanelLeft className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                        ) : (
                            <PanelLeftClose className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                        )}
                    </button>

                    {/* CENTER: Main Content - children handle their own scrolling */}
                    <main className="flex-1 min-w-0 min-h-0 flex flex-col">
                        {settings.mode === 'pdf' ? (
                            <PDFViewer
                                fileUrl={pdfUrl}
                                highlights={highlights.filter((h) => h.mode === 'pdf')}
                                onTextSelect={handlePDFTextSelect}
                            />
                        ) : hasBookContent ? (
                            <BookViewer
                                paperId={paperId}
                                bookContent={paper.book_content!}
                                pageCount={paper.page_count || 1}
                                highlights={highlights.filter((h) => h.mode === 'book')}
                                explanations={explanations}
                                onTextSelect={handleBookTextSelect}
                                onSectionVisible={handleSectionVisible}
                                onFigureClick={handleFigureClick}
                                onHighlightClick={handleHighlightClick}
                                scrollToSectionId={scrollToSectionId}
                            />
                        ) : (
                            <div className="flex-1 flex items-center justify-center p-8 overflow-auto">
                                <div className="text-center max-w-md">
                                    <div className="w-16 h-16 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mx-auto mb-6">
                                        <Sparkles className="w-8 h-8 text-blue-500" />
                                    </div>
                                    <h2 className="text-xl font-semibold mb-3">Generate Book View</h2>
                                    <p className="text-gray-600 dark:text-gray-400 mb-6">
                                        Create an AI-powered explanation with beautiful typography and diagrams.
                                    </p>
                                    <button
                                        onClick={handleGenerateBook}
                                        disabled={isGenerating}
                                        className="px-6 py-3 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-400 text-white rounded-lg font-medium flex items-center gap-2 mx-auto"
                                    >
                                        {isGenerating ? (
                                            <><Loader2 className="w-5 h-5 animate-spin" /> Generating...</>
                                        ) : (
                                            <><Sparkles className="w-5 h-5" /> Generate Book View</>
                                        )}
                                    </button>
                                    <p className="text-xs text-gray-500 mt-4">Takes 30-60 seconds</p>
                                </div>
                            </div>
                        )}
                    </main>

                    {/* RIGHT: PDF Minimap - flex child, not fixed */}
                    {settings.mode === 'book' && hasBookContent && paper.page_count && (
                        <>
                            {/* Minimap Toggle (visible when collapsed) */}
                            {minimapCollapsed && (
                                <button
                                    onClick={() => setMinimapCollapsed(false)}
                                    className="absolute z-20 right-0 top-1/2 -translate-y-1/2
                                        p-2 rounded-l-lg 
                                        bg-white dark:bg-gray-800 
                                        border border-r-0 border-gray-200 dark:border-gray-700
                                        shadow-md hover:bg-gray-50 dark:hover:bg-gray-700
                                        transition-all"
                                    title="Show PDF preview"
                                >
                                    <PanelRight className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                                </button>
                            )}

                            {/* Minimap Panel */}
                            <aside
                                className={`
                                    flex-shrink-0 min-h-0 overflow-hidden
                                    border-l border-gray-200 dark:border-gray-700
                                    bg-white dark:bg-gray-900
                                    transition-all duration-300 ease-in-out
                                `}
                                style={{ width: minimapCollapsed ? 0 : settings.minimapWidth }}
                            >
                                <PDFMinimap
                                    paperId={paperId}
                                    pageCount={paper.page_count}
                                    onSwitchToPDF={handleSwitchToPDF}
                                    onCollapse={() => setMinimapCollapsed(true)}
                                />
                            </aside>
                        </>
                    )}
                </div>

                {/* Selection popup */}
                {selectedText && selectionPosition && !inlineExplanation.isOpen && (
                    <HighlightPopup
                        position={selectionPosition}
                        onAskAI={handleAskAI}
                        onClose={() => { clearSelection(); setPendingHighlight(null); }}
                        isLoading={createHighlightMutation.isPending || createExplanationMutation.isPending}
                    />
                )}

                {/* Inline explanation */}
                <InlineExplanation
                    highlights={highlights}
                    explanations={explanations}
                    onFollowUp={handleFollowUp}
                    onTogglePin={(id, isPinned) => updateExplanationMutation.mutate({ id, data: { is_pinned: isPinned } })}
                    onToggleResolved={(id, isResolved) => updateExplanationMutation.mutate({ id, data: { is_resolved: isResolved } })}
                    onGoToPdf={handleGoToPdf}
                    isLoading={createExplanationMutation.isPending}
                />

                {/* Highlights panel */}
                <HighlightsPanel
                    highlights={highlights}
                    explanations={explanations}
                    onHighlightClick={handleHighlightClick}
                    onDeleteHighlight={handleDeleteHighlight}
                    onGoToPdf={handleGoToPdf}
                    onExportToCanvas={handleExportToCanvas}
                />

                {/* Figure viewer */}
                <FigureViewer
                    paperId={paperId}
                    pageCount={paper.page_count || 1}
                    onSaveNote={() => { }}
                    onAskQuestion={() => { }}
                />
            </div>
        </AuthGuard>
    );
}