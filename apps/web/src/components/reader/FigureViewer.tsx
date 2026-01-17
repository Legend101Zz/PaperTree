// apps/web/src/components/reader/FigureViewer.tsx
'use client';

import { useState, useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { useReaderStore } from '@/store/readerStore';
import { papersApi } from '@/lib/api';
import { X, Save, Moon, Sun, ZoomIn, ZoomOut, MessageSquare } from 'lucide-react';

if (typeof window !== 'undefined') {
    pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;
}

interface FigureViewerProps {
    paperId: string;
    pageCount: number;
    onSaveNote: (page: number, note: string) => void;
    onAskQuestion: (page: number, question: string) => void;
}

export function FigureViewer({
    paperId,
    pageCount,
    onSaveNote,
    onAskQuestion
}: FigureViewerProps) {
    const figureViewerOpen = useReaderStore((state) => state.figureViewerOpen);
    const figureViewerPage = useReaderStore((state) => state.figureViewerPage);
    const figureViewerNote = useReaderStore((state) => state.figureViewerNote);
    const closeFigureViewer = useReaderStore((state) => state.closeFigureViewer);
    const setFigureNote = useReaderStore((state) => state.setFigureNote);

    const [isDark, setIsDark] = useState(false);
    const [zoom, setZoom] = useState(1.5);
    const [showQuestion, setShowQuestion] = useState(false);
    const [question, setQuestion] = useState('');

    const pdfUrl = papersApi.getFileUrl(paperId);

    if (!figureViewerOpen) return null;

    const handleSave = () => {
        if (figureViewerNote.trim()) {
            onSaveNote(figureViewerPage, figureViewerNote);
        }
        closeFigureViewer();
    };

    const handleAsk = () => {
        if (question.trim()) {
            onAskQuestion(figureViewerPage, question);
            setQuestion('');
            setShowQuestion(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={closeFigureViewer}
            />

            {/* Modal */}
            <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                    <div className="flex items-center gap-4">
                        <h3 className="font-semibold">
                            Page {figureViewerPage + 1} of {pageCount}
                        </h3>

                        {/* Controls */}
                        <div className="flex items-center gap-1 bg-gray-200 dark:bg-gray-700 rounded-lg p-1">
                            <button
                                onClick={() => setZoom(Math.max(0.5, zoom - 0.25))}
                                className="p-1.5 hover:bg-gray-300 dark:hover:bg-gray-600 rounded"
                            >
                                <ZoomOut className="w-4 h-4" />
                            </button>
                            <span className="text-sm w-12 text-center">{Math.round(zoom * 100)}%</span>
                            <button
                                onClick={() => setZoom(Math.min(3, zoom + 0.25))}
                                className="p-1.5 hover:bg-gray-300 dark:hover:bg-gray-600 rounded"
                            >
                                <ZoomIn className="w-4 h-4" />
                            </button>
                        </div>

                        <button
                            onClick={() => setIsDark(!isDark)}
                            className={`p-2 rounded-lg transition-colors ${isDark ? 'bg-gray-700 text-yellow-400' : 'hover:bg-gray-200'
                                }`}
                        >
                            {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                        </button>
                    </div>

                    <button
                        onClick={closeFigureViewer}
                        className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* PDF Content */}
                <div className={`flex-1 overflow-auto p-4 ${isDark ? 'bg-gray-900' : 'bg-gray-100'}`}>
                    <div className={`flex justify-center ${isDark ? 'pdf-inverted' : ''}`}>
                        <Document file={pdfUrl}>
                            <Page
                                pageNumber={figureViewerPage + 1}
                                scale={zoom}
                                renderTextLayer={false}
                                renderAnnotationLayer={false}
                                className="shadow-lg"
                            />
                        </Document>
                    </div>
                </div>

                {/* Note / Question Section */}
                <div className="border-t border-gray-200 dark:border-gray-700 p-4 bg-gray-50 dark:bg-gray-800">
                    {showQuestion ? (
                        <div className="space-y-3">
                            <label className="text-sm font-medium">Ask a question about this figure:</label>
                            <textarea
                                value={question}
                                onChange={(e) => setQuestion(e.target.value)}
                                placeholder="What does this diagram show? How does this relate to..."
                                className="w-full px-3 py-2 border rounded-lg resize-none h-20 dark:bg-gray-700 dark:border-gray-600"
                                autoFocus
                            />
                            <div className="flex gap-2">
                                <button
                                    onClick={handleAsk}
                                    disabled={!question.trim()}
                                    className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
                                >
                                    Ask AI
                                </button>
                                <button
                                    onClick={() => setShowQuestion(false)}
                                    className="px-4 py-2 border rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <label className="text-sm font-medium">Add a note (optional):</label>
                            <textarea
                                value={figureViewerNote}
                                onChange={(e) => setFigureNote(e.target.value)}
                                placeholder="Your notes about this figure..."
                                className="w-full px-3 py-2 border rounded-lg resize-none h-16 dark:bg-gray-700 dark:border-gray-600"
                            />
                            <div className="flex gap-2">
                                <button
                                    onClick={handleSave}
                                    className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600"
                                >
                                    <Save className="w-4 h-4" />
                                    {figureViewerNote.trim() ? 'Save Note & Close' : 'Close'}
                                </button>
                                <button
                                    onClick={() => setShowQuestion(true)}
                                    className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                                >
                                    <MessageSquare className="w-4 h-4" />
                                    Ask AI
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}