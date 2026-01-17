// apps/web/src/app/paper/[id]/read/page.tsx
'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { ReaderToolbar } from '@/components/reader/ReaderToolbar';
import { PDFViewer } from '@/components/reader/PDFViewer';
import { BookViewer } from '@/components/reader/BookViewer';
import { SmartOutlinePanel } from '@/components/reader/SmartOutlinePanel';
import { ExplanationPanel } from '@/components/reader/ExplanationPanel';
import { HighlightPopup } from '@/components/reader/HighlightPopup';
import { PDFMinimap } from '@/components/reader/PDFMinimap';
import { FigureViewer } from '@/components/reader/FigureViewer';
import { useReaderStore } from '@/store/readerStore';
import { papersApi, highlightsApi, explanationsApi } from '@/lib/api';
import { PaperDetail } from '@/types';
import { Sparkles, Loader2 } from 'lucide-react';

export default function ReaderPage() {
    const params = useParams();
    const router = useRouter();
    const paperId = params.id as string;
    const queryClient = useQueryClient();

    // Store
    const settings = useReaderStore((state) => state.settings);
    const highlights = useReaderStore((state) => state.highlights);
    const explanations = useReaderStore((state) => state.explanations);
    const selectedText = useReaderStore((state) => state.selectedText);
    const selectionPosition = useReaderStore((state) => state.selectionPosition);
    const activeHighlightId = useReaderStore((state) => state.activeHighlightId);
    const currentPdfPage = useReaderStore((state) => state.currentPdfPage);

    const setHighlights = useReaderStore((state) => state.setHighlights);
    const setExplanations = useReaderStore((state) => state.setExplanations);
    const addHighlight = useReaderStore((state) => state.addHighlight);
    const addExplanation = useReaderStore((state) => state.addExplanation);
    const setSelection = useReaderStore((state) => state.setSelection);
    const clearSelection = useReaderStore((state) => state.clearSelection);
    const updateExplanation = useReaderStore((state) => state.updateExplanation);
    const setActiveHighlight = useReaderStore((state) => state.setActiveHighlight);
    const setCurrentSection = useReaderStore((state) => state.setCurrentSection);
    const setMode = useReaderStore((state) => state.setMode);
    const resetReaderState = useReaderStore((state) => state.resetReaderState);
    const openFigureViewer = useReaderStore((state) => state.openFigureViewer);

    const [pendingHighlight, setPendingHighlight] = useState<any>(null);
    const [scrollToSectionId, setScrollToSectionId] = useState<string | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);

    // Reset on paper change
    useEffect(() => {
        resetReaderState();
    }, [paperId, resetReaderState]);

    // Fetch paper
    const { data: paper, isLoading, refetch: refetchPaper } = useQuery({
        queryKey: ['paper', paperId],
        queryFn: () => papersApi.get(paperId) as Promise<PaperDetail>,
        enabled: !!paperId,
    });

    // Fetch highlights & explanations
    const { data: fetchedHighlights } = useQuery({
        queryKey: ['highlights', paperId],
        queryFn: () => highlightsApi.list(paperId),
        enabled: !!paperId,
    });

    const { data: fetchedExplanations } = useQuery({
        queryKey: ['explanations', paperId],
        queryFn: () => explanationsApi.list(paperId),
        enabled: !!paperId,
    });

    useEffect(() => {
        if (fetchedHighlights) setHighlights(fetchedHighlights);
    }, [fetchedHighlights, setHighlights]);

    useEffect(() => {
        if (fetchedExplanations) setExplanations(fetchedExplanations);
    }, [fetchedExplanations, setExplanations]);

    // Mutations
    const createHighlightMutation = useMutation({
        mutationFn: (data: any) => highlightsApi.create(paperId, data),
        onSuccess: (newHighlight) => addHighlight(newHighlight),
    });

    const createExplanationMutation = useMutation({
        mutationFn: (data: any) => explanationsApi.create(paperId, data),
        onSuccess: (newExplanation) => {
            addExplanation(newExplanation);
            queryClient.invalidateQueries({ queryKey: ['explanations', paperId] });
        },
    });

    const updateExplanationMutation = useMutation({
        mutationFn: ({ id, data }: { id: string; data: any }) => explanationsApi.update(id, data),
        onSuccess: (updated) => updateExplanation(updated.id, updated),
    });

    // Generate book content
    const handleGenerateBook = async () => {
        setIsGenerating(true);
        try {
            await papersApi.generateBook(paperId);
            await refetchPaper();
            setMode('book');
        } catch (error) {
            console.error('Failed to generate book content:', error);
            alert('Failed to generate. Please try again.');
        } finally {
            setIsGenerating(false);
        }
    };

    // Section visibility - syncs minimap
    const handleSectionVisible = useCallback((sectionId: string, pdfPages: number[]) => {
        const page = pdfPages[0] ?? 0;
        setCurrentSection(sectionId, page);
    }, [setCurrentSection]);

    // Figure click - opens figure viewer or syncs minimap
    const handleFigureClick = useCallback((figureId: string, pdfPage: number) => {
        openFigureViewer(pdfPage);
    }, [openFigureViewer]);

    // Outline click
    const handleOutlineClick = useCallback((sectionId: string) => {
        setScrollToSectionId(sectionId);
        setTimeout(() => setScrollToSectionId(null), 100);
    }, []);

    // PDF page click from outline
    const handlePdfPageClick = useCallback((page: number) => {
        setCurrentSection(null, page);
    }, [setCurrentSection]);

    // Switch to PDF mode
    const handleSwitchToPDF = useCallback((page: number) => {
        setCurrentSection(null, page);
        setMode('pdf');
    }, [setMode, setCurrentSection]);

    // Book text selection
    const handleBookTextSelect = useCallback((text: string, sectionId: string, pdfPage: number) => {
        if (!text.trim()) return;
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return;
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        setSelection(text, { x: rect.right, y: rect.top });
        setPendingHighlight({ mode: 'book', selected_text: text, section_id: sectionId, page_number: pdfPage });
    }, [setSelection]);

    // PDF text selection
    const handlePDFTextSelect = useCallback((text: string, pageNumber: number, rects: any[]) => {
        if (!text.trim()) return;
        const rect = rects[0];
        setSelection(text, { x: rect.x + rect.w, y: rect.y });
        setPendingHighlight({
            mode: 'pdf',
            selected_text: text,
            page_number: pageNumber,
            rects: rects.map(r => ({
                x: r.x / window.innerWidth,
                y: r.y / window.innerHeight,
                w: r.w / window.innerWidth,
                h: r.h / window.innerHeight,
            })),
        });
    }, [setSelection]);

    // Ask AI
    const handleAskAI = useCallback(async (question: string) => {
        if (!pendingHighlight) return;
        try {
            const highlight = await createHighlightMutation.mutateAsync(pendingHighlight);
            await createExplanationMutation.mutateAsync({ highlight_id: highlight.id, question });
            clearSelection();
            setPendingHighlight(null);
        } catch (error) {
            console.error('Failed:', error);
        }
    }, [pendingHighlight, createHighlightMutation, createExplanationMutation, clearSelection]);

    // Follow-up
    const handleFollowUp = useCallback(async (parentId: string, question: string) => {
        const parent = explanations.find(e => e.id === parentId);
        if (!parent) return;
        await createExplanationMutation.mutateAsync({
            highlight_id: parent.highlight_id,
            question,
            parent_id: parentId,
        });
    }, [explanations, createExplanationMutation]);

    // Save figure note
    const handleSaveFigureNote = useCallback((page: number, note: string) => {
        console.log('Save note for page', page, ':', note);
        // Could save to backend or local storage
    }, []);

    // Ask about figure
    const handleAskFigureQuestion = useCallback(async (page: number, question: string) => {
        // Create a highlight for this figure question
        try {
            const highlight = await createHighlightMutation.mutateAsync({
                mode: 'pdf',
                selected_text: `[Figure on page ${page + 1}]`,
                page_number: page + 1,
            });
            await createExplanationMutation.mutateAsync({
                highlight_id: highlight.id,
                question,
            });
        } catch (error) {
            console.error('Failed:', error);
        }
    }, [createHighlightMutation, createExplanationMutation]);

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

    return (
        <AuthGuard>
            <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-950">
                <ReaderToolbar
                    paperId={paperId}
                    paperTitle={paper.title}
                    hasBookContent={hasBookContent}
                    onGenerateBook={handleGenerateBook}
                    isGenerating={isGenerating}
                />

                <div className="flex-1 flex overflow-hidden">
                    {/* Left - Outline */}
                    <div className="w-64 border-r border-gray-200 dark:border-gray-700 overflow-y-auto 
                         hidden lg:block bg-white dark:bg-gray-900 flex-shrink-0">
                        <SmartOutlinePanel
                            outline={paper.smart_outline || []}
                            onSectionClick={handleOutlineClick}
                            onPdfPageClick={handlePdfPageClick}
                        />
                    </div>

                    {/* Main content */}
                    <div className="flex-1 flex overflow-hidden">
                        <div className="flex-1 overflow-hidden">
                            {settings.mode === 'pdf' ? (
                                <PDFViewer
                                    fileUrl={pdfUrl}
                                    highlights={highlights.filter(h => h.mode === 'pdf')}
                                    onTextSelect={handlePDFTextSelect}
                                />
                            ) : hasBookContent ? (
                                <BookViewer
                                    paperId={paperId}
                                    bookContent={paper.book_content!}
                                    outline={paper.smart_outline || []}
                                    pageCount={paper.page_count || 1}
                                    highlights={highlights.filter(h => h.mode === 'book')}
                                    onTextSelect={handleBookTextSelect}
                                    onSectionVisible={handleSectionVisible}
                                    onFigureClick={handleFigureClick}
                                    scrollToSectionId={scrollToSectionId}
                                />
                            ) : (
                                <div className="flex-1 flex items-center justify-center p-8">
                                    <div className="text-center max-w-md">
                                        <div className="w-16 h-16 rounded-full bg-blue-100 dark:bg-blue-900/30 
                                   flex items-center justify-center mx-auto mb-6">
                                            <Sparkles className="w-8 h-8 text-blue-500" />
                                        </div>
                                        <h2 className="text-xl font-semibold mb-3">Generate Book View</h2>
                                        <p className="text-gray-600 dark:text-gray-400 mb-6">
                                            Create an AI-powered explanation that's easy to read with beautiful typography,
                                            rendered equations, and generated diagrams.
                                        </p>
                                        <button
                                            onClick={handleGenerateBook}
                                            disabled={isGenerating}
                                            className="px-6 py-3 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-400
                                text-white rounded-lg font-medium transition-colors
                                flex items-center gap-2 mx-auto"
                                        >
                                            {isGenerating ? (
                                                <>
                                                    <Loader2 className="w-5 h-5 animate-spin" />
                                                    Generating...
                                                </>
                                            ) : (
                                                <>
                                                    <Sparkles className="w-5 h-5" />
                                                    Generate Book View
                                                </>
                                            )}
                                        </button>
                                        <p className="text-xs text-gray-500 mt-4">Takes 30-60 seconds</p>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* PDF Minimap */}
                        {settings.mode === 'book' && hasBookContent && paper.page_count && (
                            <PDFMinimap
                                paperId={paperId}
                                pageCount={paper.page_count}
                                onSwitchToPDF={handleSwitchToPDF}
                            />
                        )}
                    </div>

                    {/* Right - Explanations */}
                    <div className="w-80 border-l border-gray-200 dark:border-gray-700 overflow-y-auto 
                         hidden xl:block bg-white dark:bg-gray-900 flex-shrink-0">
                        <ExplanationPanel
                            highlights={highlights}
                            explanations={explanations}
                            onFollowUp={handleFollowUp}
                            onTogglePin={(id, isPinned) =>
                                updateExplanationMutation.mutate({ id, data: { is_pinned: isPinned } })
                            }
                            onToggleResolved={(id, isResolved) =>
                                updateExplanationMutation.mutate({ id, data: { is_resolved: isResolved } })
                            }
                            onSummarize={async (id) => {
                                const result = await explanationsApi.summarize(id);
                                alert(result.summary);
                            }}
                            onHighlightClick={setActiveHighlight}
                            onSendToCanvas={() => { }}
                            isLoading={createExplanationMutation.isPending}
                            activeHighlightId={activeHighlightId}
                        />
                    </div>
                </div>

                {/* Highlight popup */}
                {selectedText && selectionPosition && (
                    <HighlightPopup
                        position={selectionPosition}
                        onAskAI={handleAskAI}
                        onClose={() => {
                            clearSelection();
                            setPendingHighlight(null);
                        }}
                        isLoading={createHighlightMutation.isPending || createExplanationMutation.isPending}
                    />
                )}

                {/* Figure Viewer Modal */}
                <FigureViewer
                    paperId={paperId}
                    pageCount={paper.page_count || 1}
                    onSaveNote={handleSaveFigureNote}
                    onAskQuestion={handleAskFigureQuestion}
                />
            </div>
        </AuthGuard>
    );
}