'use client';

import { useReaderStore } from '@/store/readerStore';
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
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface ReaderToolbarProps {
    paperId: string;
    paperTitle: string;
    onSearch: (query: string) => void;
}

export function ReaderToolbar({ paperId, paperTitle, onSearch }: ReaderToolbarProps) {
    const router = useRouter();
    const { settings, setTheme, setFontSize, setMode } = useReaderStore();
    const [searchQuery, setSearchQuery] = useState('');
    const [showSearch, setShowSearch] = useState(false);

    const themes = [
        { value: 'light', icon: Sun, label: 'Light' },
        { value: 'dark', icon: Moon, label: 'Dark' },
        { value: 'sepia', icon: BookOpen, label: 'Sepia' },
    ] as const;

    return (
        <div className="sticky top-0 z-40 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-4 py-2">
            <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => router.push('/dashboard')}
                    >
                        <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <h1 className="font-medium truncate max-w-xs">{paperTitle}</h1>
                </div>

                <div className="flex items-center gap-2">
                    {/* Theme toggle */}
                    <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
                        {themes.map(({ value, icon: Icon }) => (
                            <button
                                key={value}
                                onClick={() => setTheme(value)}
                                className={`p-1.5 rounded-md transition-colors ${settings.theme === value
                                        ? 'bg-white dark:bg-gray-700 shadow-sm'
                                        : 'hover:bg-gray-200 dark:hover:bg-gray-700'
                                    }`}
                            >
                                <Icon className="w-4 h-4" />
                            </button>
                        ))}
                    </div>

                    {/* Font size */}
                    <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
                        <button
                            onClick={() => setFontSize(Math.max(12, settings.fontSize - 2))}
                            className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-md"
                        >
                            <Minus className="w-4 h-4" />
                        </button>
                        <span className="text-sm w-8 text-center">{settings.fontSize}</span>
                        <button
                            onClick={() => setFontSize(Math.min(24, settings.fontSize + 2))}
                            className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-md"
                        >
                            <Plus className="w-4 h-4" />
                        </button>
                    </div>

                    {/* Mode toggle */}
                    <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
                        <button
                            onClick={() => setMode('pdf')}
                            className={`p-1.5 rounded-md transition-colors ${settings.mode === 'pdf'
                                    ? 'bg-white dark:bg-gray-700 shadow-sm'
                                    : 'hover:bg-gray-200 dark:hover:bg-gray-700'
                                }`}
                        >
                            <FileText className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => setMode('book')}
                            className={`p-1.5 rounded-md transition-colors ${settings.mode === 'book'
                                    ? 'bg-white dark:bg-gray-700 shadow-sm'
                                    : 'hover:bg-gray-200 dark:hover:bg-gray-700'
                                }`}
                        >
                            <BookOpen className="w-4 h-4" />
                        </button>
                    </div>

                    {/* Search */}
                    {showSearch ? (
                        <div className="flex items-center gap-2">
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') onSearch(searchQuery);
                                }}
                                placeholder="Search in paper..."
                                className="px-3 py-1.5 border rounded-lg text-sm w-48 dark:bg-gray-800 dark:border-gray-700"
                                autoFocus
                            />
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                    setShowSearch(false);
                                    setSearchQuery('');
                                }}
                            >
                                ×
                            </Button>
                        </div>
                    ) : (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowSearch(true)}
                        >
                            <Search className="w-4 h-4" />
                        </Button>
                    )}

                    {/* Canvas link */}
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => router.push(`/paper/${paperId}/canvas`)}
                    >
                        <Layout className="w-4 h-4 mr-1" />
                        Canvas
                    </Button>
                </div>
            </div>
        </div>
    );
}