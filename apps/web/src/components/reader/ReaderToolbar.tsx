// apps/web/src/components/reader/ReaderToolbar.tsx
'use client';

import { useReaderStore } from '@/store/readerStore';
import { Button } from '@/components/ui/Button';
import {
    Sun, Moon, BookOpen, FileText, ChevronLeft,
    Layout, Minus, Plus, Settings, Sparkles, Loader2, Contrast
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface ReaderToolbarProps {
    paperId: string;
    paperTitle: string;
    hasBookContent: boolean;
    onGenerateBook: () => void;
    isGenerating: boolean;
}

export function ReaderToolbar({
    paperId,
    paperTitle,
    hasBookContent,
    onGenerateBook,
    isGenerating,
}: ReaderToolbarProps) {
    const router = useRouter();
    const settings = useReaderStore((state) => state.settings);
    const setTheme = useReaderStore((state) => state.setTheme);
    const setFontSize = useReaderStore((state) => state.setFontSize);
    const setMode = useReaderStore((state) => state.setMode);
    const setFontFamily = useReaderStore((state) => state.setFontFamily);
    const setLineHeight = useReaderStore((state) => state.setLineHeight);
    const setPageWidth = useReaderStore((state) => state.setPageWidth);
    const setInvertPdf = useReaderStore((state) => state.setInvertPdf);

    const [showSettings, setShowSettings] = useState(false);

    return (
        <div className="sticky top-0 z-40 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
            <div className="px-4 py-2 flex items-center justify-between gap-4">
                {/* Left */}
                <div className="flex items-center gap-2 min-w-0">
                    <Button variant="ghost" size="sm" onClick={() => router.push('/dashboard')}>
                        <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <h1 className="font-medium truncate max-w-xs">{paperTitle}</h1>
                </div>

                {/* Center - Mode toggle */}
                <div className="flex items-center gap-2">
                    <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
                        <button
                            onClick={() => setMode('book')}
                            disabled={!hasBookContent}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-md transition-all ${settings.mode === 'book'
                                    ? 'bg-white dark:bg-gray-700 shadow-sm'
                                    : 'hover:bg-gray-200 dark:hover:bg-gray-700'
                                } ${!hasBookContent ? 'opacity-50 cursor-not-allowed' : ''}`}
                            title={hasBookContent ? 'Book Mode' : 'Generate book content first'}
                        >
                            <Sparkles className="w-4 h-4" />
                            <span className="text-sm font-medium hidden sm:inline">Book</span>
                        </button>
                        <button
                            onClick={() => setMode('pdf')}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-md transition-all ${settings.mode === 'pdf'
                                    ? 'bg-white dark:bg-gray-700 shadow-sm'
                                    : 'hover:bg-gray-200 dark:hover:bg-gray-700'
                                }`}
                        >
                            <FileText className="w-4 h-4" />
                            <span className="text-sm font-medium hidden sm:inline">PDF</span>
                        </button>
                    </div>

                    {/* Generate Book button */}
                    {!hasBookContent && (
                        <button
                            onClick={onGenerateBook}
                            disabled={isGenerating}
                            className="flex items-center gap-2 px-3 py-1.5 bg-blue-500 hover:bg-blue-600 
                        text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-70"
                        >
                            {isGenerating ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                                <Sparkles className="w-4 h-4" />
                            )}
                            <span className="hidden sm:inline">
                                {isGenerating ? 'Generating...' : 'Generate Book'}
                            </span>
                        </button>
                    )}

                    {/* PDF Dark Mode (only in PDF mode) */}
                    {settings.mode === 'pdf' && (
                        <button
                            onClick={() => setInvertPdf(!settings.invertPdf)}
                            className={`p-2 rounded-lg transition-colors ${settings.invertPdf
                                    ? 'bg-gray-800 text-yellow-400'
                                    : 'bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700'
                                }`}
                            title={settings.invertPdf ? 'Light PDF' : 'Dark PDF'}
                        >
                            <Contrast className="w-4 h-4" />
                        </button>
                    )}
                </div>

                {/* Right */}
                <div className="flex items-center gap-1 sm:gap-2">
                    {/* Theme */}
                    <div className="hidden sm:flex items-center bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
                        {[
                            { value: 'light' as const, icon: Sun },
                            { value: 'dark' as const, icon: Moon },
                            { value: 'sepia' as const, icon: BookOpen },
                        ].map(({ value, icon: Icon }) => (
                            <button
                                key={value}
                                onClick={() => setTheme(value)}
                                className={`p-1.5 rounded-md transition-colors ${settings.theme === value
                                        ? 'bg-white dark:bg-gray-700 shadow-sm'
                                        : 'hover:bg-gray-200 dark:hover:bg-gray-700'
                                    }`}
                                title={value}
                            >
                                <Icon className="w-4 h-4" />
                            </button>
                        ))}
                    </div>

                    {/* Font size */}
                    <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
                        <button
                            onClick={() => setFontSize(Math.max(14, settings.fontSize - 2))}
                            className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-md"
                        >
                            <Minus className="w-4 h-4" />
                        </button>
                        <span className="text-sm w-6 text-center">{settings.fontSize}</span>
                        <button
                            onClick={() => setFontSize(Math.min(28, settings.fontSize + 2))}
                            className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-md"
                        >
                            <Plus className="w-4 h-4" />
                        </button>
                    </div>

                    {/* Settings */}
                    <div className="relative">
                        <button
                            onClick={() => setShowSettings(!showSettings)}
                            className="p-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700"
                        >
                            <Settings className="w-4 h-4" />
                        </button>

                        {showSettings && (
                            <>
                                <div className="fixed inset-0 z-40" onClick={() => setShowSettings(false)} />
                                <div className="absolute right-0 top-full mt-2 w-64 bg-white dark:bg-gray-800 
                               rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-4 z-50">
                                    <h3 className="font-semibold text-sm mb-4">Reading Settings</h3>

                                    {/* Font family */}
                                    <div className="mb-4">
                                        <label className="text-xs text-gray-500 block mb-2">Font Family</label>
                                        <div className="flex gap-1">
                                            {(['serif', 'sans', 'mono'] as const).map((font) => (
                                                <button
                                                    key={font}
                                                    onClick={() => setFontFamily(font)}
                                                    className={`flex-1 px-2 py-1.5 text-xs rounded-lg capitalize ${settings.fontFamily === font
                                                            ? 'bg-blue-100 dark:bg-blue-900 text-blue-600'
                                                            : 'bg-gray-100 dark:bg-gray-700'
                                                        }`}
                                                >
                                                    {font}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Line height */}
                                    <div className="mb-4">
                                        <label className="text-xs text-gray-500 block mb-2">
                                            Line Height: {settings.lineHeight.toFixed(1)}
                                        </label>
                                        <input
                                            type="range"
                                            min="1.4"
                                            max="2.2"
                                            step="0.1"
                                            value={settings.lineHeight}
                                            onChange={(e) => setLineHeight(parseFloat(e.target.value))}
                                            className="w-full accent-blue-500"
                                        />
                                    </div>

                                    {/* Page width */}
                                    <div className="mb-4">
                                        <label className="text-xs text-gray-500 block mb-2">
                                            Content Width: {settings.pageWidth}px
                                        </label>
                                        <input
                                            type="range"
                                            min="500"
                                            max="900"
                                            step="20"
                                            value={settings.pageWidth}
                                            onChange={(e) => setPageWidth(parseInt(e.target.value))}
                                            className="w-full accent-blue-500"
                                        />
                                    </div>

                                    <button
                                        onClick={() => setShowSettings(false)}
                                        className="w-full py-2 text-sm bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600"
                                    >
                                        Done
                                    </button>
                                </div>
                            </>
                        )}
                    </div>

                    {/* Canvas */}
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => router.push(`/paper/${paperId}/canvas`)}
                        className="hidden sm:flex"
                    >
                        <Layout className="w-4 h-4" />
                    </Button>
                </div>
            </div>
        </div>
    );
}