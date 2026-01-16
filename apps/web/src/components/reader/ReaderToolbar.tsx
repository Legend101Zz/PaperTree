'use client';

import { useReaderStore, FontFamily } from '@/store/readerStore';
import { Button } from '@/components/ui/Button';
import {
    Sun,
    Moon,
    BookOpen,
    FileText,
    Search,
    ChevronLeft,
    Layout,
    Minus,
    Plus,
    Settings,
    Contrast,
    X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useCallback } from 'react';

interface ReaderToolbarProps {
    paperId: string;
    paperTitle: string;
    onSearch: (query: string) => void;
    searchQuery?: string;
    setSearchQuery?: (query: string) => void;
}

export function ReaderToolbar({
    paperId,
    paperTitle,
    onSearch,
    searchQuery = '',
    setSearchQuery
}: ReaderToolbarProps) {
    const router = useRouter();
    const settings = useReaderStore((state) => state.settings);
    const setTheme = useReaderStore((state) => state.setTheme);
    const setFontSize = useReaderStore((state) => state.setFontSize);
    const setMode = useReaderStore((state) => state.setMode);
    const setFontFamily = useReaderStore((state) => state.setFontFamily);
    const setInvertPdf = useReaderStore((state) => state.setInvertPdf);
    const setLineHeight = useReaderStore((state) => state.setLineHeight);
    const setPageWidth = useReaderStore((state) => state.setPageWidth);
    const setMarginSize = useReaderStore((state) => state.setMarginSize);

    const [showSearch, setShowSearch] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [localSearchQuery, setLocalSearchQuery] = useState(searchQuery);

    const handleSearch = useCallback(() => {
        if (setSearchQuery) {
            setSearchQuery(localSearchQuery);
        }
        onSearch(localSearchQuery);
    }, [localSearchQuery, onSearch, setSearchQuery]);

    const clearSearch = useCallback(() => {
        setLocalSearchQuery('');
        if (setSearchQuery) {
            setSearchQuery('');
        }
        setShowSearch(false);
    }, [setSearchQuery]);

    return (
        <div className="sticky top-0 z-40 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
            <div className="px-4 py-2 flex items-center justify-between gap-4">
                {/* Left section */}
                <div className="flex items-center gap-2 min-w-0">
                    <Button variant="ghost" size="sm" onClick={() => router.push('/dashboard')}>
                        <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <h1 className="font-medium truncate">{paperTitle}</h1>
                </div>

                {/* Right section */}
                <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
                    {/* Theme toggle */}
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
                                title={value.charAt(0).toUpperCase() + value.slice(1)}
                            >
                                <Icon className="w-4 h-4" />
                            </button>
                        ))}
                    </div>

                    {/* Font size */}
                    <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
                        <button
                            onClick={() => setFontSize(Math.max(12, settings.fontSize - 2))}
                            className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-md"
                        >
                            <Minus className="w-4 h-4" />
                        </button>
                        <span className="text-sm w-6 text-center">{settings.fontSize}</span>
                        <button
                            onClick={() => setFontSize(Math.min(32, settings.fontSize + 2))}
                            className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-md"
                        >
                            <Plus className="w-4 h-4" />
                        </button>
                    </div>

                    {/* Mode toggle */}
                    <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
                        <button
                            onClick={() => setMode('pdf')}
                            className={`p-1.5 rounded-md transition-colors ${settings.mode === 'pdf'
                                    ? 'bg-white dark:bg-gray-700 shadow-sm'
                                    : 'hover:bg-gray-200 dark:hover:bg-gray-700'
                                }`}
                            title="PDF Mode"
                        >
                            <FileText className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => setMode('book')}
                            className={`p-1.5 rounded-md transition-colors ${settings.mode === 'book'
                                    ? 'bg-white dark:bg-gray-700 shadow-sm'
                                    : 'hover:bg-gray-200 dark:hover:bg-gray-700'
                                }`}
                            title="Book Mode"
                        >
                            <BookOpen className="w-4 h-4" />
                        </button>
                    </div>

                    {/* PDF Inversion (only in PDF mode) */}
                    {settings.mode === 'pdf' && (
                        <button
                            onClick={() => setInvertPdf(!settings.invertPdf)}
                            className={`p-1.5 rounded-lg transition-colors ${settings.invertPdf
                                    ? 'bg-blue-100 dark:bg-blue-900 text-blue-600'
                                    : 'bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700'
                                }`}
                            title="Dark PDF"
                        >
                            <Contrast className="w-4 h-4" />
                        </button>
                    )}

                    {/* Settings dropdown */}
                    <div className="relative">
                        <button
                            onClick={() => setShowSettings(!showSettings)}
                            className="p-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700"
                            title="Settings"
                        >
                            <Settings className="w-4 h-4" />
                        </button>

                        {showSettings && (
                            <>
                                <div
                                    className="fixed inset-0 z-40"
                                    onClick={() => setShowSettings(false)}
                                />
                                <div className="absolute right-0 top-full mt-2 w-72 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-4 z-50">
                                    <h3 className="font-semibold text-sm mb-4">Reading Settings</h3>

                                    {/* Font Family (book mode only) */}
                                    {settings.mode === 'book' && (
                                        <div className="mb-4">
                                            <label className="text-xs text-gray-500 block mb-2">
                                                Font Family
                                            </label>
                                            <div className="flex gap-1">
                                                {(['serif', 'sans', 'mono'] as FontFamily[]).map((font) => (
                                                    <button
                                                        key={font}
                                                        onClick={() => setFontFamily(font)}
                                                        className={`flex-1 px-2 py-1.5 text-xs rounded-lg transition-colors ${settings.fontFamily === font
                                                                ? 'bg-blue-100 dark:bg-blue-900 text-blue-600'
                                                                : 'bg-gray-100 dark:bg-gray-700 hover:bg-gray-200'
                                                            }`}
                                                    >
                                                        {font.charAt(0).toUpperCase() + font.slice(1)}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Line Height */}
                                    <div className="mb-4">
                                        <label className="text-xs text-gray-500 block mb-2">
                                            Line Height: {settings.lineHeight.toFixed(1)}
                                        </label>
                                        <input
                                            type="range"
                                            min="1.2"
                                            max="2.4"
                                            step="0.1"
                                            value={settings.lineHeight}
                                            onChange={(e) => setLineHeight(parseFloat(e.target.value))}
                                            className="w-full accent-blue-500"
                                        />
                                    </div>

                                    {/* Page Width */}
                                    <div className="mb-4">
                                        <label className="text-xs text-gray-500 block mb-2">
                                            Page Width: {settings.pageWidth}px
                                        </label>
                                        <input
                                            type="range"
                                            min="480"
                                            max="960"
                                            step="40"
                                            value={settings.pageWidth}
                                            onChange={(e) => setPageWidth(parseInt(e.target.value))}
                                            className="w-full accent-blue-500"
                                        />
                                    </div>

                                    {/* Margins */}
                                    <div className="mb-4">
                                        <label className="text-xs text-gray-500 block mb-2">
                                            Margins
                                        </label>
                                        <div className="flex gap-1">
                                            {(['compact', 'normal', 'wide'] as const).map((margin) => (
                                                <button
                                                    key={margin}
                                                    onClick={() => setMarginSize(margin)}
                                                    className={`flex-1 px-2 py-1.5 text-xs rounded-lg transition-colors ${settings.marginSize === margin
                                                            ? 'bg-blue-100 dark:bg-blue-900 text-blue-600'
                                                            : 'bg-gray-100 dark:bg-gray-700 hover:bg-gray-200'
                                                        }`}
                                                >
                                                    {margin.charAt(0).toUpperCase() + margin.slice(1)}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Theme (mobile) */}
                                    <div className="sm:hidden mb-4">
                                        <label className="text-xs text-gray-500 block mb-2">
                                            Theme
                                        </label>
                                        <div className="flex gap-1">
                                            {(['light', 'dark', 'sepia'] as const).map((t) => (
                                                <button
                                                    key={t}
                                                    onClick={() => setTheme(t)}
                                                    className={`flex-1 px-2 py-1.5 text-xs rounded-lg transition-colors ${settings.theme === t
                                                            ? 'bg-blue-100 dark:bg-blue-900 text-blue-600'
                                                            : 'bg-gray-100 dark:bg-gray-700 hover:bg-gray-200'
                                                        }`}
                                                >
                                                    {t.charAt(0).toUpperCase() + t.slice(1)}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <button
                                        onClick={() => setShowSettings(false)}
                                        className="w-full py-2 text-sm bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200"
                                    >
                                        Done
                                    </button>
                                </div>
                            </>
                        )}
                    </div>

                    {/* Search */}
                    {showSearch ? (
                        <div className="flex items-center gap-1">
                            <input
                                type="text"
                                value={localSearchQuery}
                                onChange={(e) => setLocalSearchQuery(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleSearch();
                                    if (e.key === 'Escape') clearSearch();
                                }}
                                placeholder="Search..."
                                className="w-32 sm:w-48 px-3 py-1.5 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700"
                                autoFocus
                            />
                            <button
                                onClick={clearSearch}
                                className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    ) : (
                        <button
                            onClick={() => setShowSearch(true)}
                            className="p-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700"
                        >
                            <Search className="w-4 h-4" />
                        </button>
                    )}

                    {/* Canvas link */}
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => router.push(`/paper/${paperId}/canvas`)}
                        className="hidden sm:flex"
                    >
                        <Layout className="w-4 h-4 sm:mr-1" />
                        <span className="hidden sm:inline">Canvas</span>
                    </Button>
                </div>
            </div>
        </div>
    );
}