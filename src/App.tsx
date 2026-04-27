import React, { useState, useRef, useEffect } from 'react';
import { PDFDocument, BlendMode, degrees } from 'pdf-lib';
import { FileText, Upload, Download, LayoutDashboard, FileUp, FileOutput, Loader2, Image as ImageIcon, Save, History, Trash2, MapPin, Plus, Leaf } from 'lucide-react';
import { get, set, del } from 'idb-keyval';

interface Templates {
  header: string;
  footer: string;
  watermark: string;
}

interface HistoryMeta {
  id: string;
  filename: string;
  date: number;
}

interface LocationMeta {
  id: string;
  name: string;
  description: string;
  address: string;
}

const removeWhiteBackground = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas not supported'));
        return;
      }
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        if (r > 240 && g > 240 && b > 240) {
          data[i + 3] = 0;
        }
      }
      
      ctx.putImageData(imageData, 0, 0);
      canvas.toBlob((blob) => {
        if (blob) {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        } else {
          reject(new Error('Canvas to Blob failed'));
        }
      }, 'image/png');
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
};

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = error => reject(error);
  });
};

const generateLandscapeTemplate = (dataUrl: string, ratio: number): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const outW = img.width * ratio;
      canvas.width = outW;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas not supported'));
        return;
      }

      const leftW = (outW - 0.98 * img.width) / 2;
      const midW = 0.98 * img.width;
      const rightW = leftW;

      // Draw left 1% stretched
      ctx.drawImage(img, 0, 0, img.width * 0.01, img.height, 0, 0, leftW, img.height);
      // Draw middle 98% normal
      ctx.drawImage(img, img.width * 0.01, 0, img.width * 0.98, img.height, leftW, 0, midW, img.height);
      // Draw right 1% stretched
      ctx.drawImage(img, img.width * 0.99, 0, img.width * 0.01, img.height, leftW + midW, 0, rightW, img.height);

      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
};

export default function App() {
  const [templates, setTemplates] = useState<Templates | null>(null);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(true);
  const [currentView, setCurrentView] = useState<'dashboard' | 'history' | 'locations'>('dashboard');
  
  // Setup State
  const [setupHeader, setSetupHeader] = useState<File | null>(null);
  const [setupFooter, setSetupFooter] = useState<File | null>(null);
  const [setupWatermark, setSetupWatermark] = useState<File | null>(null);
  const [isSavingSetup, setIsSavingSetup] = useState(false);

  // Locations State
  const [locations, setLocations] = useState<LocationMeta[]>([]);
  const [showLocationForm, setShowLocationForm] = useState(false);
  const [locName, setLocName] = useState('');
  const [locDesc, setLocDesc] = useState('');
  const [locAddr, setLocAddr] = useState('');

  // Document Detail State (Filename generation)
  const [projectName, setProjectName] = useState(() => localStorage.getItem('renovki_projectName') || '');
  const [week, setWeek] = useState(() => localStorage.getItem('renovki_week') || '');
  const [target, setTarget] = useState(() => localStorage.getItem('renovki_target') || 'Klien');
  const [weight, setWeight] = useState(() => localStorage.getItem('renovki_weight') || '');

  // App State
  const [pdfFiles, setPdfFiles] = useState<File[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processedPdfUrl, setProcessedPdfUrl] = useState<string | null>(null);
  const [generatedFilename, setGeneratedFilename] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // History State
  const [history, setHistory] = useState<HistoryMeta[]>([]);

  useEffect(() => {
    const loadTemplates = () => {
      const header = localStorage.getItem('renovki_header');
      const footer = localStorage.getItem('renovki_footer');
      const watermark = localStorage.getItem('renovki_watermark');
      
      if (header && footer && watermark) {
        setTemplates({ header, footer, watermark });
      }
      setIsLoadingTemplates(false);
    };
    const loadLocations = async () => {
      try {
        const locs = await get<LocationMeta[]>('history_locations') || [];
        setLocations(locs);
      } catch (err) {
        console.error('Failed to load locations', err);
      }
    };
    loadTemplates();
    loadHistory();
    loadLocations();
  }, []);

  const saveLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!locName.trim()) return;
    
    const newLoc: LocationMeta = { 
      id: Date.now().toString(), 
      name: locName, 
      description: locDesc, 
      address: locAddr 
    };
    
    try {
      const updated = [...locations, newLoc];
      await set('history_locations', updated);
      setLocations(updated);
      setShowLocationForm(false);
      setLocName('');
      setLocDesc('');
      setLocAddr('');
    } catch (err) {
      console.error('Failed to save location', err);
    }
  };

  const deleteLocation = async (id: string) => {
    if (!window.confirm('Hapus lokasi ini?')) return;
    try {
      const updated = locations.filter(l => l.id !== id);
      await set('history_locations', updated);
      setLocations(updated);
    } catch (err) {
      console.error('Failed to delete location', err);
    }
  };

  useEffect(() => {
    localStorage.setItem('renovki_projectName', projectName);
    localStorage.setItem('renovki_week', week);
    localStorage.setItem('renovki_target', target);
    localStorage.setItem('renovki_weight', weight);
  }, [projectName, week, target, weight]);

  const loadHistory = async () => {
    try {
      const meta = await get<HistoryMeta[]>('history_meta') || [];
      setHistory(meta.sort((a, b) => b.date - a.date));
    } catch (err) {
      console.error('Failed to load history', err);
    }
  };

  const addToHistory = async (filename: string, pdfBytes: Uint8Array) => {
    try {
      const id = Date.now().toString();
      const newMeta: HistoryMeta = { id, filename, date: Date.now() };
      
      const existingMeta = await get<HistoryMeta[]>('history_meta') || [];
      const updatedMeta = [...existingMeta, newMeta];
      
      await set('history_meta', updatedMeta);
      await set(`pdf_${id}`, pdfBytes);
      
      setHistory(updatedMeta.sort((a, b) => b.date - a.date));
    } catch (err) {
      console.error('Failed to save to history', err);
    }
  };

  const downloadFromHistory = async (id: string, filename: string) => {
    try {
      const pdfBytes = await get<Uint8Array>(`pdf_${id}`);
      if (pdfBytes) {
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        alert('File PDF tidak ditemukan di penyimpanan lokal.');
      }
    } catch (err) {
      console.error('Failed to download from history', err);
      alert('Gagal mengunduh file.');
    }
  };

  const deleteFromHistory = async (id: string) => {
    if (!window.confirm('Apakah Anda yakin ingin menghapus draft ini dari riwayat?')) return;
    try {
      const existingMeta = await get<HistoryMeta[]>('history_meta') || [];
      const updatedMeta = existingMeta.filter(m => m.id !== id);
      await set('history_meta', updatedMeta);
      await del(`pdf_${id}`);
      setHistory(updatedMeta.sort((a, b) => b.date - a.date));
    } catch (err) {
      console.error('Failed to delete from history', err);
    }
  };

  const handleSaveSetup = async () => {
    if (!setupHeader || !setupFooter || !setupWatermark) {
      setError('Mohon upload ketiga gambar template (Header, Footer, Watermark).');
      return;
    }

    setIsSavingSetup(true);
    setError(null);

    try {
      const headerB64 = await fileToBase64(setupHeader);
      const footerB64 = await fileToBase64(setupFooter);
      const watermarkB64 = await removeWhiteBackground(setupWatermark);

      localStorage.setItem('renovki_header', headerB64);
      localStorage.setItem('renovki_footer', footerB64);
      localStorage.setItem('renovki_watermark', watermarkB64);

      setTemplates({
        header: headerB64,
        footer: footerB64,
        watermark: watermarkB64
      });
    } catch (err) {
      console.error(err);
      setError('Gagal menyimpan template. Pastikan ukuran gambar tidak terlalu besar.');
    } finally {
      setIsSavingSetup(false);
    }
  };

  const resetTemplates = () => {
    if (window.confirm('Apakah Anda yakin ingin mereset template?')) {
      localStorage.removeItem('renovki_header');
      localStorage.removeItem('renovki_footer');
      localStorage.removeItem('renovki_watermark');
      setTemplates(null);
      setProcessedPdfUrl(null);
      setPdfFiles([]);
    }
  };

  const getFilename = () => {
    const p = projectName.trim() || 'Project';
    const w = week.trim() ? `P.${week.trim()}` : 'P.X';
    const t = `(${target})`;
    const b = weight.trim() ? `Bobot ${weight.trim()}` : 'Bobot X';
    return `${p} ${w} ${t} ${b}.pdf`;
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files).filter(f => f.type === 'application/pdf');
      if (files.length === 0) {
        setError('Please upload valid PDF files.');
        return;
      }
      setPdfFiles(files);
      await processPdfs(files);
    }
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files).filter(f => f.type === 'application/pdf');
      if (files.length === 0) {
        setError('Please upload valid PDF files.');
        return;
      }
      setPdfFiles(files);
      await processPdfs(files);
    }
  };

  const processPdfs = async (files: File[]) => {
    if (!templates || files.length === 0) return;
    
    setIsProcessing(true);
    setError(null);

    try {
      const mergedPdf = await PDFDocument.create();

      let pagesToProcess: { pdfDoc: PDFDocument, index: number }[] = [];

      // Cari file berdasarkan nama (menghapus spasi dan .pdf)
      const getBaseName = (name: string) => name.toLowerCase().replace('.pdf', '').trim();
      const filePdf = files.find(f => getBaseName(f.name) === 'file' || f.name.toLowerCase().includes('file'));
      const tsPdf = files.find(f => getBaseName(f.name) === 'ts' || f.name.toLowerCase().includes('ts'));

      if (files.length === 2 && filePdf && tsPdf && filePdf !== tsPdf) {
        // --- MODE SPESIFIK: Hapus Page 2 dari "file", ganti dengan isi dari "ts" ---
        const fileArrayBuf = await filePdf.arrayBuffer();
        const fileDoc = await PDFDocument.load(fileArrayBuf);
        
        const tsArrayBuf = await tsPdf.arrayBuffer();
        const tsDoc = await PDFDocument.load(tsArrayBuf);

        const fileIndices = fileDoc.getPageIndices();
        const tsIndices = tsDoc.getPageIndices();
        
        for (let i = 0; i < fileIndices.length; i++) {
          if (i === 1) { 
            // Halaman 2 (index 1) dari file dihapus/digantikan dengan seluruh pdf TS
            for (const j of tsIndices) {
              pagesToProcess.push({ pdfDoc: tsDoc, index: j });
            }
          } else {
            pagesToProcess.push({ pdfDoc: fileDoc, index: i });
          }
        }
      } else {
        // --- MODE NORMAL: Gabung semua urut berdasarkan nama ---
        const sortedFiles = [...files].sort((a, b) => 
          a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
        );

        for (const file of sortedFiles) {
          const arrayBuffer = await file.arrayBuffer();
          const pdfDoc = await PDFDocument.load(arrayBuffer);
          const indices = pdfDoc.getPageIndices();
          for (const index of indices) {
            pagesToProcess.push({ pdfDoc, index });
          }
        }
      }

      let globalPageIndex = 0;

      for (const { pdfDoc, index } of pagesToProcess) {
        globalPageIndex++;
        // Halaman ke-2 selalu landscape, sisanya portrait
        const isTargetLandscape = (globalPageIndex === 2);

        const page = pdfDoc.getPage(index);
        const angle = page.getRotation().angle;

          const embeddedPage = await mergedPdf.embedPage(page);
          const dims = embeddedPage.scale(1);

          const isVisuallyLandscape = (angle === 90 || angle === 270) 
              ? dims.height > dims.width 
              : dims.width > dims.height;

          const visualWidth = (angle === 90 || angle === 270) ? dims.height : dims.width;
          const visualHeight = (angle === 90 || angle === 270) ? dims.width : dims.height;

          const A4_W = 595.28;
          const A4_H = 841.89;

          let finalWidth, finalHeight;
          let additionalRotation = 0;
          let shouldCenterAndFit = true;

          if (isTargetLandscape) {
              // Ukuran kertas dipaksa landscape A4
              finalWidth = A4_H;
              finalHeight = A4_W;
              
              // Putar tabel agar selaras dan mengisi ruang landscape dengan optimal
              if (!isVisuallyLandscape) {
                  additionalRotation = 270 + 90; // Putar tambahan 90 derajat dari sebelumnya (270)
              } else {
                  additionalRotation = 90; // Putar tambahan 90 derajat dari sebelumnya (0)
              }
          } else {
              // Ukuran kertas dipaksa portrait A4
              finalWidth = A4_W;
              finalHeight = A4_H;
              if (isVisuallyLandscape) {
                  additionalRotation = 270;
              } else {
                  additionalRotation = 0;
              }
          }

          const totalRotation = angle + additionalRotation;
          const normalizedRotation = ((totalRotation % 360) + 360) % 360;

          const newPage = mergedPdf.addPage([finalWidth, finalHeight]);
          
          let tx = 0, ty = 0;
          let drawW = dims.width;
          let drawH = dims.height;

          if (shouldCenterAndFit) {
              const contentVisualWidth = (normalizedRotation === 90 || normalizedRotation === 270) ? dims.height : dims.width;
              const contentVisualHeight = (normalizedRotation === 90 || normalizedRotation === 270) ? dims.width : dims.height;

              // Scale to fit finalWidth and finalHeight (keep aspect ratio)
              let scale = Math.min(finalWidth / contentVisualWidth, finalHeight / contentVisualHeight);
              
              if (isTargetLandscape) {
                  // Perbesar 2 kali lipat khusus untuk page landscape
                  scale *= 2.0;
              }
              
              drawW = dims.width * scale;
              drawH = dims.height * scale;
              
              const scaledVisualWidth = contentVisualWidth * scale;
              const scaledVisualHeight = contentVisualHeight * scale;

              if (normalizedRotation === 0) {
                  tx = (finalWidth - scaledVisualWidth) / 2;
                  ty = (finalHeight - scaledVisualHeight) / 2;
              } else if (normalizedRotation === 90) {
                  tx = (finalWidth - scaledVisualWidth) / 2 + scaledVisualWidth;
                  ty = (finalHeight - scaledVisualHeight) / 2;
              } else if (normalizedRotation === 180) {
                  tx = (finalWidth - scaledVisualWidth) / 2 + scaledVisualWidth;
                  ty = (finalHeight - scaledVisualHeight) / 2 + scaledVisualHeight;
              } else if (normalizedRotation === 270) {
                  tx = (finalWidth - scaledVisualWidth) / 2;
                  ty = (finalHeight - scaledVisualHeight) / 2 + scaledVisualHeight;
              }
          } else {
              if (normalizedRotation === 0) {
                  tx = 0; ty = 0;
              } else if (normalizedRotation === 90) {
                  tx = finalWidth; ty = 0;
              } else if (normalizedRotation === 180) {
                  tx = finalWidth; ty = finalHeight;
              } else if (normalizedRotation === 270) {
                  tx = 0; ty = finalHeight;
              }
          }
          
          if (shouldCenterAndFit && isTargetLandscape) {
              // Buat turun 20% dari posisi terakhir 30%, jadi total turun 50%
              ty -= finalHeight * 0.5;
          }

          newPage.drawPage(embeddedPage, {
              x: tx,
              y: ty,
              width: drawW,
              height: drawH,
              rotate: degrees(normalizedRotation)
          });
        }

      const fetchImage = async (dataUrl: string) => {
        const res = await fetch(dataUrl);
        return await res.arrayBuffer();
      };

      const headerBytes = await fetchImage(templates.header);
      const footerBytes = await fetchImage(templates.footer);
      const watermarkBytes = await fetchImage(templates.watermark);

      const isHeaderPng = templates.header.startsWith('data:image/png');
      const isFooterPng = templates.footer.startsWith('data:image/png');
      const isWatermarkPng = templates.watermark.startsWith('data:image/png');

      const embeddedHeader = isHeaderPng ? await mergedPdf.embedPng(headerBytes) : await mergedPdf.embedJpg(headerBytes);
      const embeddedFooter = isFooterPng ? await mergedPdf.embedPng(footerBytes) : await mergedPdf.embedJpg(footerBytes);
      const embeddedWatermark = isWatermarkPng ? await mergedPdf.embedPng(watermarkBytes) : await mergedPdf.embedJpg(watermarkBytes);

      const pages = mergedPdf.getPages();

      let pWidth = 595.28, pHeight = 841.89;
      if (pages.length > 0) {
          const s = pages[0].getSize();
          pWidth = Math.min(s.width, s.height);
          pHeight = Math.max(s.width, s.height);
      }
      const landscapeRatio = pHeight / pWidth;

      const lsHeaderDataUrl = await generateLandscapeTemplate(templates.header, landscapeRatio);
      const lsFooterDataUrl = await generateLandscapeTemplate(templates.footer, landscapeRatio);

      const lsHeaderBytes = await fetchImage(lsHeaderDataUrl);
      const lsFooterBytes = await fetchImage(lsFooterDataUrl);

      const embeddedLsHeader = await mergedPdf.embedPng(lsHeaderBytes);
      const embeddedLsFooter = await mergedPdf.embedPng(lsFooterBytes);

      for (const page of pages) {
        const { width, height } = page.getSize();
        const isLandscape = width > height;
        
        const currentHeader = isLandscape ? embeddedLsHeader : embeddedHeader;
        const currentFooter = isLandscape ? embeddedLsFooter : embeddedFooter;

        // Header
        const headerDims = currentHeader.scale(1);
        const headerScale = width / headerDims.width;
        // Mengurangi tinggi header sebesar 20% (dikali 0.8) agar lebih pendek
        const scaledHeaderHeight = (headerDims.height * headerScale) * 0.8;
        page.drawImage(currentHeader, {
          x: 0,
          y: height - scaledHeaderHeight,
          width: width,
          height: scaledHeaderHeight,
        });

        // Footer
        const footerDims = currentFooter.scale(1);
        const footerScale = width / footerDims.width;
        // Mengurangi tinggi footer sebesar 20% (dikali 0.8) agar lebih pendek
        const scaledFooterHeight = (footerDims.height * footerScale) * 0.8;
        page.drawImage(currentFooter, {
          x: 0,
          y: 0,
          width: width,
          height: scaledFooterHeight,
        });

        // Watermark
        const wmDims = embeddedWatermark.scale(1);
        const maxWmWidth = width * 0.6;
        const maxWmHeight = height * 0.6;
        const wmScale = Math.min(maxWmWidth / wmDims.width, maxWmHeight / wmDims.height);
        const scaledWmWidth = wmDims.width * wmScale;
        const scaledWmHeight = wmDims.height * wmScale;
        
        page.drawImage(embeddedWatermark, {
          x: width / 2 - scaledWmWidth / 2,
          y: height / 2 - scaledWmHeight / 2,
          width: scaledWmWidth,
          height: scaledWmHeight,
          opacity: 0.15,
          blendMode: BlendMode.Multiply,
        });
      }

      const pdfBytes = await mergedPdf.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      
      const filename = getFilename();
      setGeneratedFilename(filename);
      setProcessedPdfUrl(url);
      
      // Save to history
      await addToHistory(filename, pdfBytes);

    } catch (err) {
      console.error(err);
      setError('An error occurred while processing the PDF.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownload = () => {
    if (processedPdfUrl && pdfFiles.length > 0) {
      const a = document.createElement('a');
      a.href = processedPdfUrl;
      a.download = generatedFilename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  const formatDate = (timestamp: number) => {
    return new Intl.DateTimeFormat('id-ID', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(timestamp));
  };

  if (isLoadingTemplates) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-green-600" />
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-green-50 font-sans relative overflow-hidden text-gray-800">
      {/* Background Banana with Fluted Glass */}
      <div className="absolute inset-0 z-0 bg-[url('https://images.unsplash.com/photo-1528825871115-3581a5387919?auto=format&fit=crop&q=80')] bg-cover bg-center" />
      <div className="absolute inset-0 z-0 backdrop-blur-md bg-white/40" style={{ backgroundImage: 'repeating-linear-gradient(90deg, transparent, transparent 10px, rgba(255,255,255,0.2) 10px, rgba(255,255,255,0.2) 20px)' }} />

      <div className="relative z-10 flex h-full w-full">
      {/* Sidebar */}
      <aside className="w-64 bg-white/80 backdrop-blur-xl border-r border-green-200/50 flex flex-col">
        <div 
          className="h-16 flex items-center px-6 border-b border-green-200/50 cursor-pointer select-none" 
          onDoubleClick={resetTemplates}
          title="Double-click to reset templates"
        >
          <div className="flex items-center gap-2 text-transparent bg-clip-text bg-gradient-to-br from-green-600 to-green-400 font-bold text-xl tracking-tight">
            <Leaf className="w-6 h-6 text-green-500" />
            <span>Eco Renovki</span>
          </div>
        </div>
        
        <nav className="flex-1 p-4 space-y-1">
          <button 
            onClick={() => setCurrentView('dashboard')}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-md font-medium transition-colors ${currentView === 'dashboard' ? 'bg-gradient-to-r from-green-500 to-green-400 text-white shadow-sm' : 'text-gray-600 hover:bg-green-50'}`}
          >
            <LayoutDashboard className="w-5 h-5" />
            Dashboard
          </button>
          <button 
            onClick={() => setCurrentView('locations')}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-md font-medium transition-colors ${currentView === 'locations' ? 'bg-gradient-to-r from-green-500 to-green-400 text-white shadow-sm' : 'text-gray-600 hover:bg-green-50'}`}
          >
            <MapPin className="w-5 h-5" />
            Lokasi
          </button>
          <button 
            onClick={() => setCurrentView('history')}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-md font-medium transition-colors ${currentView === 'history' ? 'bg-gradient-to-r from-green-500 to-green-400 text-white shadow-sm' : 'text-gray-600 hover:bg-green-50'}`}
          >
            <History className="w-5 h-5" />
            Riwayat
          </button>
        </nav>
        
        <div className="p-4 border-t border-green-200/50 text-xs text-gray-500 text-center relative overflow-hidden">
          {/* Watermark Logo in sidebar background */}
          <Leaf className="absolute -right-4 -bottom-4 w-24 h-24 text-green-100 opacity-50 z-0 pointer-events-none" />
          <div className="relative z-10">
            &copy; 2026 Eco Renovki<br/>
            <span className="opacity-70">Double-click logo to reset</span>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden bg-white/40 backdrop-blur-sm">
        <header className="h-16 bg-white/60 backdrop-blur-md border-b border-green-200/50 flex items-center px-8 relative overflow-hidden">
          <Leaf className="absolute -top-10 -right-10 w-40 h-40 text-green-500/10 z-0 pointer-events-none" />
          <h1 className="text-xl font-semibold text-gray-800 relative z-10">
            {currentView === 'dashboard' ? 'Dashboard' : currentView === 'history' ? 'Riwayat Dokumen' : 'Data Lokasi'}
          </h1>
        </header>

        <div className="flex-1 overflow-auto p-8 relative z-10">
          <div className="max-w-5xl mx-auto">
            
            {error && (
              <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg flex items-center gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-red-500"></div>
                {error}
              </div>
            )}

            {!templates ? (
              /* Setup Screen */
              <div className="bg-white/80 backdrop-blur-md rounded-xl shadow-sm border border-green-200/50 p-8">
                <div className="text-center mb-8">
                  <h2 className="text-2xl font-bold text-gray-900">Setup Template Satu Kali</h2>
                  <p className="text-gray-500 mt-2">Silakan unggah ketiga gambar template Anda di sini. Ini hanya perlu dilakukan sekali.</p>
                </div>

                <div className="space-y-6">
                  {/* Header Upload */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">1. Upload Gambar Header</label>
                    <div className="flex items-center gap-4">
                      <label className="flex-1 flex items-center justify-center px-4 py-4 border-2 border-dashed border-green-300 rounded-lg bg-white hover:bg-green-50 focus-within:ring-2 focus-within:ring-green-400 cursor-pointer transition-colors">
                        <input type="file" accept="image/png, image/jpeg" className="hidden" onChange={(e) => e.target.files && setSetupHeader(e.target.files[0])} />
                        <div className="flex items-center gap-2 text-gray-600">
                          <ImageIcon className="w-5 h-5 text-green-500" />
                          <span>{setupHeader ? setupHeader.name : 'Pilih Gambar Header'}</span>
                        </div>
                      </label>
                    </div>
                  </div>

                  {/* Footer Upload */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">2. Upload Gambar Footer</label>
                    <div className="flex items-center gap-4">
                      <label className="flex-1 flex items-center justify-center px-4 py-4 border-2 border-dashed border-green-300 rounded-lg bg-white hover:bg-green-50 focus-within:ring-2 focus-within:ring-green-400 cursor-pointer transition-colors">
                        <input type="file" accept="image/png, image/jpeg" className="hidden" onChange={(e) => e.target.files && setSetupFooter(e.target.files[0])} />
                        <div className="flex items-center gap-2 text-gray-600">
                          <ImageIcon className="w-5 h-5 text-green-500" />
                          <span>{setupFooter ? setupFooter.name : 'Pilih Gambar Footer'}</span>
                        </div>
                      </label>
                    </div>
                  </div>

                  {/* Watermark Upload */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">3. Upload Gambar Watermark</label>
                    <div className="flex items-center gap-4">
                      <label className="flex-1 flex items-center justify-center px-4 py-4 border-2 border-dashed border-green-300 rounded-lg bg-white hover:bg-green-50 focus-within:ring-2 focus-within:ring-green-400 cursor-pointer transition-colors">
                        <input type="file" accept="image/png, image/jpeg" className="hidden" onChange={(e) => e.target.files && setSetupWatermark(e.target.files[0])} />
                        <div className="flex items-center gap-2 text-gray-600">
                          <ImageIcon className="w-5 h-5 text-green-500" />
                          <span>{setupWatermark ? setupWatermark.name : 'Pilih Gambar Watermark'}</span>
                        </div>
                      </label>
                    </div>
                    <p className="text-xs text-gray-500 mt-2">Background putih akan otomatis dihapus.</p>
                  </div>

                  <button
                    onClick={handleSaveSetup}
                    disabled={isSavingSetup || !setupHeader || !setupFooter || !setupWatermark}
                    className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-green-500 to-green-400 text-white py-3 px-4 rounded-lg font-medium hover:from-green-600 hover:to-green-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm mt-8"
                  >
                    {isSavingSetup ? (
                      <><Loader2 className="w-5 h-5 animate-spin" /> Menyimpan Template...</>
                    ) : (
                      <><Save className="w-5 h-5" /> Simpan Template & Mulai</>
                    )}
                  </button>
                </div>
              </div>
            ) : currentView === 'dashboard' ? (
              /* Dashboard View */
              <div className="space-y-6">
                
                {/* Detail Dokumen Form */}
                <div className="bg-white/80 backdrop-blur-md rounded-xl shadow-sm border border-green-200/50 p-6">
                  <div className="flex flex-col md:flex-row md:items-center justify-between mb-4 gap-4">
                    <h3 className="text-lg font-semibold text-gray-900">Detail Dokumen (Untuk Penamaan File)</h3>
                    {locations.length > 0 && (
                      <div className="flex items-center gap-2">
                        <label className="text-sm font-medium text-gray-700 whitespace-nowrap">Isi dari Lokasi:</label>
                        <select 
                          className="px-3 py-1.5 bg-white border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 text-sm w-full md:w-auto"
                          onChange={(e) => {
                            const loc = locations.find(l => l.id === e.target.value);
                            if (loc) {
                              setProjectName(loc.name);
                            }
                          }}
                          defaultValue=""
                        >
                          <option value="" disabled>-- Pilih Lokasi --</option>
                          {locations.map(loc => (
                            <option key={loc.id} value={loc.id}>{loc.name}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Nama Project</label>
                      <input 
                        type="text" 
                        value={projectName} 
                        onChange={e => setProjectName(e.target.value)} 
                        placeholder="Contoh: Renovasi Rumah Bpk. Budi" 
                        className="w-full px-3 py-2 bg-white border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500" 
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Pekan Ke-</label>
                      <div className="flex items-center">
                        <span className="px-3 py-2 bg-gray-100 border border-r-0 border-gray-300 rounded-l-md text-gray-500">P.</span>
                        <input 
                          type="text" 
                          value={week} 
                          onChange={e => setWeek(e.target.value)} 
                          placeholder="1" 
                          className="w-full px-3 py-2 bg-white border border-gray-300 rounded-r-md focus:outline-none focus:ring-2 focus:ring-green-500" 
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Klien / Kantor</label>
                      <select 
                        value={target} 
                        onChange={e => setTarget(e.target.value)} 
                        className="w-full px-3 py-2 bg-white border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500"
                      >
                        <option value="Klien">Klien</option>
                        <option value="Kantor">Kantor</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Bobot</label>
                      <input 
                        type="text" 
                        value={weight} 
                        onChange={e => setWeight(e.target.value)} 
                        placeholder="Contoh: 20%" 
                        className="w-full px-3 py-2 bg-white border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500" 
                      />
                    </div>
                  </div>
                  <div className="mt-4 p-3 bg-green-50/50 rounded-md border border-green-100">
                    <p className="text-sm text-green-800">
                      <strong>Preview Nama File:</strong> {getFilename()}
                    </p>
                  </div>
                </div>

                {/* Upload Area */}
                <div className="bg-white/80 backdrop-blur-md rounded-xl shadow-sm border border-green-200/50 p-8">
                  <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={handleDrop}
                    className="border-2 border-dashed border-green-300 rounded-xl p-12 text-center bg-white/50 hover:bg-green-50 transition-colors cursor-pointer"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileChange}
                      accept="application/pdf"
                      className="hidden"
                      multiple
                    />
                    <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
                      <FileUp className="w-8 h-8" />
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-1">Upload PDF Document(s)</h3>
                    <p className="text-gray-500 mb-4">Drag and drop multiple PDFs here, or click to browse. Files will be merged automatically based on their names (e.g. 1.pdf, 2.pdf).</p>
                    <span className="inline-flex items-center justify-center px-4 py-2 bg-white border border-gray-300 rounded-md text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50">
                      Select Files
                    </span>
                  </div>
                </div>

                {/* Processing & Result Area */}
                {(isProcessing || processedPdfUrl) && (
                  <div className="bg-white/80 backdrop-blur-md rounded-xl shadow-sm border border-green-200/50 p-8">
                    {isProcessing ? (
                      <div className="flex flex-col items-center justify-center py-12">
                        <Loader2 className="w-12 h-12 animate-spin text-green-500 mb-4" />
                        <h3 className="text-lg font-medium text-gray-900">Memproses PDF...</h3>
                        <p className="text-gray-500">Menerapkan Header, Footer, dan Watermark</p>
                      </div>
                    ) : processedPdfUrl ? (
                      <div className="flex flex-col items-center justify-center py-8">
                        <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mb-4">
                          <FileOutput className="w-8 h-8" />
                        </div>
                        <h3 className="text-xl font-semibold text-gray-900 mb-2">PDF Berhasil Diproses!</h3>
                        <p className="text-gray-500 mb-8 text-center max-w-md">
                          Dokumen Anda telah berhasil diperbarui dan disimpan ke Riwayat.
                        </p>
                        
                        <div className="flex gap-4">
                          <a
                            href={processedPdfUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 px-6 py-3 bg-white border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition-colors"
                          >
                            <FileText className="w-5 h-5" />
                            Preview PDF
                          </a>
                          <button
                            onClick={handleDownload}
                            className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-green-500 to-green-400 text-white rounded-lg font-medium hover:from-green-600 hover:to-green-500 shadow-sm"
                          >
                            <Download className="w-5 h-5" />
                            Download PDF
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            ) : currentView === 'history' ? (
              /* History View */
              <div className="bg-white/80 backdrop-blur-md rounded-xl shadow-sm border border-green-200/50 overflow-hidden">
                <div className="p-6 border-b border-green-200/50">
                  <h2 className="text-lg font-semibold text-gray-900">Riwayat Dokumen (Draft)</h2>
                  <p className="text-sm text-gray-500 mt-1">Dokumen yang telah diproses akan tersimpan di sini secara lokal di browser Anda.</p>
                </div>
                
                {history.length === 0 ? (
                  <div className="p-12 text-center text-gray-500">
                    <History className="w-12 h-12 mx-auto text-green-300 mb-3" />
                    <p>Belum ada riwayat dokumen.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse bg-white/50">
                      <thead>
                        <tr className="bg-green-50/50 border-b border-green-200/50">
                          <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Nama File</th>
                          <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Tanggal Dibuat</th>
                          <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider text-right">Aksi</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-green-200/50">
                        {history.map((item) => (
                          <tr key={item.id} className="hover:bg-green-50/50 transition-colors">
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="flex items-center gap-3">
                                <FileText className="w-5 h-5 text-green-500" />
                                <span className="font-medium text-gray-900">{item.filename}</span>
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {formatDate(item.date)}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                              <div className="flex items-center justify-end gap-3">
                                <button 
                                  onClick={() => downloadFromHistory(item.id, item.filename)}
                                  className="text-green-600 hover:text-green-900 flex items-center gap-1"
                                >
                                  <Download className="w-4 h-4" /> Download
                                </button>
                                <button 
                                  onClick={() => deleteFromHistory(item.id)}
                                  className="text-red-600 hover:text-red-900 flex items-center gap-1 ml-4"
                                >
                                  <Trash2 className="w-4 h-4" /> Hapus
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : (
              /* Locations View */
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-bold text-gray-900">Kelola Lokasi</h2>
                  <button 
                    onClick={() => setShowLocationForm(!showLocationForm)}
                    className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-green-500 to-green-400 text-white rounded-lg font-medium shadow-sm hover:from-green-600 hover:to-green-500"
                  >
                    {showLocationForm ? 'Batal Tambah' : <><Plus className="w-4 h-4" /> Tambah Lokasi</>}
                  </button>
                </div>

                {showLocationForm && (
                  <div className="bg-white/80 backdrop-blur-md rounded-xl shadow-sm border border-green-200/50 p-6">
                    <h3 className="text-lg font-medium text-gray-900 mb-4">Tambah Lokasi Baru</h3>
                    <form onSubmit={saveLocation} className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Nama Lokasi</label>
                        <input 
                          type="text" 
                          required
                          value={locName} 
                          onChange={e => setLocName(e.target.value)} 
                          placeholder="Pusat Kota" 
                          className="w-full px-3 py-2 bg-white border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500" 
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Alamat (Opsional)</label>
                        <input 
                          type="text" 
                          value={locAddr} 
                          onChange={e => setLocAddr(e.target.value)} 
                          placeholder="Jl. Raya No. 123" 
                          className="w-full px-3 py-2 bg-white border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500" 
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Detail / Deskripsi (Opsional)</label>
                        <textarea 
                          value={locDesc} 
                          onChange={e => setLocDesc(e.target.value)} 
                          placeholder="Detail tambahan lokasi ini..." 
                          rows={3}
                          className="w-full px-3 py-2 bg-white border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500" 
                        />
                      </div>
                      <div className="flex justify-end gap-3 pt-2">
                        <button type="button" onClick={() => setShowLocationForm(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md">Batal</button>
                        <button type="submit" className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 shadow-sm">Simpan</button>
                      </div>
                    </form>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {locations.length === 0 ? (
                    <div className="col-span-full p-12 text-center text-gray-500 bg-white/50 backdrop-blur-md rounded-xl border border-green-200/50">
                      <MapPin className="w-12 h-12 mx-auto text-green-300 mb-3" />
                      <p>Belum ada lokasi tersimpan.</p>
                    </div>
                  ) : (
                    locations.map(loc => (
                      <div key={loc.id} className="bg-white/80 backdrop-blur-md p-6 rounded-xl shadow-sm border border-green-200/50 flex flex-col items-start gap-3 relative group">
                        <div className="flex items-center gap-3 w-full border-b border-green-100 pb-3">
                          <div className="w-10 h-10 rounded-full bg-green-100 text-green-600 flex items-center justify-center shrink-0">
                            <MapPin className="w-5 h-5" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="font-semibold text-gray-900 truncate">{loc.name}</h4>
                            {loc.address && <p className="text-xs text-gray-500 truncate">{loc.address}</p>}
                          </div>
                        </div>
                        {loc.description && <p className="text-sm text-gray-600 flex-1">{loc.description}</p>}
                        <button 
                          onClick={() => deleteLocation(loc.id)}
                          className="mt-2 text-xs flex items-center gap-1 text-red-500 opacity-0 group-hover:opacity-100 transition-opacity bg-red-50 px-2 py-1 rounded"
                        >
                          <Trash2 className="w-3 h-3" />
                          Hapus Lokasi
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

          </div>
        </div>
      </main>
      </div>
    </div>
  );
}
