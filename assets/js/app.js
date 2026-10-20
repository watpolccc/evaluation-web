// เรียกใช้งานชุดไอคอนของ Lucide
lucide.createIcons();

// 🔗 URL ปลายทางของ Google Apps Script Web App (API ดักข้อมูลจาก Sheet)
// **ให้นำรหัส Web App ID ที่ได้จากการสั่งเผยแพร่มาวางในเครื่องหมายคำพูดด้านล่างนี้ได้เลยครับ**
const CONFIG = Object.freeze({
    apiUrl: "https://script.google.com/macros/s/AKfycbwxsIujAMe2DEQw9F9gqObNK171XoKD71qUfCyg2LikJoiPQvHX31CUA3ES_FhxlCbR/exec",
    requestTimeoutMs: 15000,
    // 🖼️ ภาพพื้นหลังส่วนหัวหน้าแรก ใส่ได้ทั้งไฟล์ในเว็บ (assets/img/...) ลิงก์ Google Drive หรือ URL รูป
    // เว้นว่างไว้ = ใช้พื้นหลังลวดลายสีน้ำเงินแบบเดิม
    // ภาพปัจจุบัน: ภาพมุมสูงวิทยาลัยจาก chetupon.ac.th (ตัดโลโก้มุมซ้ายบนออกแล้ว)
    heroImageUrl: "assets/img/hero-campus.jpg",
    // 🖼️ รูปแทนสำหรับข่าวที่ไม่มีรูปหรือรูปโหลดไม่ได้ (ตราวิทยาลัย)
    newsFallbackImage: "assets/img/college-emblem.png"
});

// ตัวแปรเก็บสะสมข้อมูลทั้งหมดที่โหลดผ่าน API มาเก็บไว้ใน Client
let localNewsData = [];
let localDocsData = [];
let localStatsData = [];

// ตัวแปรควบคุมการทำงานของหน้าข่าวสาร (Pagination: 3x3 = 9 รายการ)
let newsCurrentPage = 1;
const newsItemsPerPage = 9;
let filteredNews = [];

// ตัวแปรควบคุมหน้าดาวน์โหลดเอกสาร (Pagination: 3x3 = 9 รายการ)
let docCurrentPage = 1;
const docItemsPerPage = 9;
let filteredDocs = [];

const VALID_PAGES = new Set(['home', 'news', 'documents', 'stats']);

function asText(value) {
    return value == null ? '' : String(value).trim();
}

// ป้องกันข้อความจาก Google Sheet ถูกตีความเป็น HTML/สคริปต์
function escapeHtml(value) {
    return asText(value).replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}

// อนุญาตเฉพาะลิงก์ http/https เท่านั้น
function safeUrl(value) {
    const url = asText(value);
    if (!url || url === '#') return '';
    try {
        const parsedUrl = new URL(url);
        return ['http:', 'https:'].includes(parsedUrl.protocol) ? parsedUrl.href : '';
    } catch {
        return '';
    }
}

// ดึง File ID จากลิงก์ไฟล์ Google Drive / Docs / Sheets / Slides (ไม่รวมลิงก์โฟลเดอร์)
function getDriveFileId(url) {
    const patterns = [
        /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/,
        /drive\.google\.com\/(?:open|uc)\?(?:[^#]*&)?id=([a-zA-Z0-9_-]+)/,
        /docs\.google\.com\/(?:document|spreadsheets|presentation)\/d\/(?!e\/)([a-zA-Z0-9_-]+)/
    ];
    for (const pattern of patterns) {
        const match = asText(url).match(pattern);
        if (match) return match[1];
    }
    return '';
}

// สร้างภาพตัวอย่าง (หน้าแรกของไฟล์) จากลิงก์ Google Drive โดยอัตโนมัติ
// ไฟล์ต้องแชร์แบบ "ทุกคนที่มีลิงก์" จึงจะแสดงภาพได้
function driveThumbnail(url, width = 800) {
    const fileId = getDriveFileId(url);
    return fileId ? `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w${width}` : '';
}

function normalizeImageUrl(value) {
    const imageUrl = asText(value);
    if (!imageUrl || imageUrl === '#') return '';

    // แปลงลิงก์หน้า Preview/Share ของ Google Drive เป็นลิงก์รูปสำหรับ <img>
    const driveImage = driveThumbnail(imageUrl, 1200);
    if (driveImage) return driveImage;

    const idMatch = imageUrl.match(/google\.com\/.*[?&]id=([a-zA-Z0-9_-]+)/);
    if (idMatch) {
        return `https://drive.google.com/thumbnail?id=${encodeURIComponent(idMatch[1])}&sz=w1200`;
    }

    // ป้องกันค่าที่ไม่ใช่ URL ถูกนำไปใช้เป็น src
    return safeUrl(imageUrl);
}

function normalizeNewsItem(item = {}) {
    const link = asText(item.link);
    // ใช้รูปจากคอลัมน์ imageUrl ก่อน หากไม่มีจะใช้หน้าแรกของไฟล์แนบจาก Drive
    const imageUrl = normalizeImageUrl(item.imageUrl || item.imageURL || item.image);
    return {
        title: asText(item.title),
        date: asText(item.date),
        type: asText(item.type),
        link,
        cover: imageUrl || driveThumbnail(link)
    };
}

function normalizeDocumentItem(item = {}) {
    const link1 = asText(item.link1);
    const link2 = asText(item.link2);
    // ใช้รูปจากคอลัมน์ thumbnail ก่อน หากไม่มีจะใช้หน้าแรกของไฟล์จาก Drive
    const thumbnail = normalizeImageUrl(item.thumbnail || item.imageUrl || item.image);
    return {
        name: asText(item.name),
        category: asText(item.category),
        link1,
        type1: asText(item.type1),
        link2,
        type2: asText(item.type2),
        cover: thumbnail || driveThumbnail(link1, 600) || driveThumbnail(link2, 600)
    };
}

function normalizeStatsItem(item = {}) {
    return {
        title: asText(item.title),
        description: asText(item.description),
        link: asText(item.link),
        imageUrl: normalizeImageUrl(item.imageUrl || item.imageURL || item.image)
    };
}

// ================= ชุดสร้างภาพประกอบ (Visual Helpers) =================

// ลักษณะภาพแทนตามชนิดไฟล์ ใช้เมื่อไม่มีภาพตัวอย่าง
function getFileVisual(format) {
    const f = asText(format).toUpperCase();
    if (f.includes('PDF')) return { icon: 'file-text', label: 'PDF', bg: 'from-red-500 to-rose-700' };
    if (f.includes('XLS') || f.includes('EXCEL') || f.includes('CSV')) return { icon: 'file-spreadsheet', label: 'Excel', bg: 'from-emerald-500 to-emerald-700' };
    if (f.includes('DOC') || f.includes('WORD')) return { icon: 'file-type-2', label: 'Word', bg: 'from-blue-500 to-blue-800' };
    return { icon: 'file', label: '', bg: 'from-slate-500 to-slate-700' };
}

// ภาพปก: แสดงรูปจริงเมื่อโหลดได้ หากโหลดไม่ได้จะเหลือภาพแทน (fallback) ที่วางอยู่ด้านหลัง
// fallbackSrc: รูปสำรองเมื่อไม่มีรูปหรือรูปหลักโหลดไม่ได้ (เช่น ตราวิทยาลัยสำหรับข่าว)
function coverHtml({ src, alt = '', icon = 'image', label = '', bg = 'from-blue-800 to-blue-950', sizeClass = 'aspect-video', position = 'object-top', lazy = true, fallbackSrc = '' }) {
    let imageSrc = safeUrl(src);
    const fallback = fallbackSrc ? new URL(fallbackSrc, window.location.href).href : '';
    if (!imageSrc && fallback) {
        imageSrc = fallback;
        position = 'object-center';
    }
    const errorHandler = fallback && imageSrc !== fallback
        ? `this.onerror=function(){this.remove()};this.classList.replace('${position}','object-center');this.src='${fallback}'`
        : 'this.remove()';
    return `
        <div class="cover-frame relative ${sizeClass} overflow-hidden bg-gradient-to-br ${bg}">
            <div class="absolute inset-0 hero-pattern-soft"></div>
            <div class="absolute inset-0 flex flex-col items-center justify-center text-white/90">
                <i data-lucide="${icon}" class="w-10 h-10 mb-1"></i>
                ${label ? `<span class="text-xs font-bold tracking-wider">${escapeHtml(label)}</span>` : ''}
            </div>
            ${imageSrc ? `<img src="${escapeHtml(imageSrc)}" alt="${escapeHtml(alt)}" loading="${lazy ? 'lazy' : 'eager'}" referrerpolicy="no-referrer"
                class="cover-img absolute inset-0 w-full h-full object-cover ${position} bg-white opacity-0"
                onload="this.classList.remove('opacity-0')" onerror="${escapeHtml(errorHandler)}">` : ''}
        </div>`;
}

// ภาพประกอบเมื่อไม่มีข้อมูล (Empty State)
function emptyStateHtml(message, icon = 'inbox') {
    return `
        <div class="col-span-full py-14 flex flex-col items-center text-center text-slate-400">
            <svg viewBox="0 0 200 140" class="w-44 h-auto mb-4" aria-hidden="true">
                <ellipse cx="100" cy="128" rx="70" ry="8" fill="#e2e8f0"/>
                <rect x="45" y="30" width="80" height="92" rx="10" fill="#fff" stroke="#cbd5e1" stroke-width="3"/>
                <rect x="75" y="18" width="80" height="92" rx="10" fill="#eff6ff" stroke="#93c5fd" stroke-width="3"/>
                <rect x="88" y="38" width="54" height="6" rx="3" fill="#bfdbfe"/>
                <rect x="88" y="52" width="40" height="6" rx="3" fill="#bfdbfe"/>
                <rect x="88" y="66" width="48" height="6" rx="3" fill="#bfdbfe"/>
                <circle cx="150" cy="96" r="16" fill="#fbbf24"/>
                <path d="M143 96h14M150 89v14" stroke="#fff" stroke-width="3" stroke-linecap="round"/>
            </svg>
            <p class="font-medium flex items-center"><i data-lucide="${icon}" class="w-4 h-4 mr-1.5"></i>${escapeHtml(message)}</p>
        </div>`;
}

// ป้ายประเภทข่าว — หากคอลัมน์ type เป็นชนิดไฟล์ (PDF/Word) จะแสดงเป็น "ประกาศ"
function getNewsBadge(type) {
    const value = asText(type);
    const isFileFormat = /^(pdf|docx?|xlsx?|word|excel|jpe?g|png|gif|web|website|video|link|ไฟล์.*|ลิงก์.*)$/i.test(value);
    const label = !value || isFileFormat ? 'ประกาศ' : value;
    let color = 'bg-blue-100 text-blue-800 border-blue-200';
    if (label === 'ด่วน') color = 'bg-red-100 text-red-800 border-red-200';
    else if (label === 'ข่าวสาร') color = 'bg-emerald-100 text-emerald-800 border-emerald-200';
    return `<span class="px-2.5 py-1 rounded-lg text-xs font-bold border ${color}">${escapeHtml(label)}</span>`;
}

// ภาพแทนของข่าว เลือกไอคอนตามชนิดของลิงก์แนบ
function getNewsVisual(item) {
    const type = asText(item.type).toUpperCase();
    const link = asText(item.link);
    if (type.includes('VIDEO') || /youtu\.?be/.test(link)) return { icon: 'play-circle', label: 'วิดีโอ', bg: 'from-rose-600 to-red-800' };
    if (/drive\.google\.com\/drive\/folders/.test(link)) return { icon: 'folder-open', label: 'โฟลเดอร์เอกสาร', bg: 'from-amber-500 to-amber-700' };
    if (/JPE?G|PNG|GIF|IMAGE|รูป/.test(type)) return { icon: 'image', label: 'รูปภาพ', bg: 'from-sky-600 to-blue-800' };
    if (type.includes('WEB') || (link && !getDriveFileId(link))) return { icon: 'globe', label: 'เว็บไซต์', bg: 'from-indigo-600 to-blue-900' };
    if (type.includes('PDF')) return { icon: 'file-text', label: 'เอกสาร PDF', bg: 'from-blue-800 to-blue-950' };
    return { icon: 'megaphone', label: 'ข่าวประชาสัมพันธ์', bg: 'from-blue-800 to-blue-950' };
}

function newsCover(item, sizeClass = 'aspect-video', lazy = true) {
    const visual = getNewsVisual(item);
    // ข่าวที่ไม่มีรูป/รูปโหลดไม่ได้ จะแสดงตราวิทยาลัยแบบเดียวกับการ์ดในหน้าข้อมูลสถิติ
    return coverHtml({ src: item.cover, alt: item.title, icon: visual.icon, label: visual.label, bg: visual.bg, sizeClass, lazy, fallbackSrc: CONFIG.newsFallbackImage });
}

function docCover(doc, sizeClass = 'h-44') {
    const visual = getFileVisual(doc.type1 || doc.type2);
    return coverHtml({ src: doc.cover, alt: doc.name, icon: visual.icon, label: visual.label, bg: visual.bg, sizeClass });
}

// ส่วนหัวหน้าแรก: ใส่ภาพพื้นหลังจาก CONFIG.heroImageUrl (ถ้ามี)
function renderHero() {
    const hero = document.getElementById('home-hero');
    // รองรับทั้งไฟล์ในเว็บ (path) และ URL เต็ม
    let heroImage = '';
    try {
        heroImage = CONFIG.heroImageUrl ? normalizeImageUrl(new URL(CONFIG.heroImageUrl, window.location.href).href) : '';
    } catch {
        heroImage = '';
    }
    if (hero && heroImage) {
        hero.style.backgroundImage = `linear-gradient(180deg, rgba(23,37,84,.82) 0%, rgba(30,58,138,.68) 100%), url("${heroImage.replace(/"/g, '%22')}")`;
        hero.classList.add('hero-photo');
    }

}

function normalizeApiResponse(result) {
    if (!result || result.status !== 'success') {
        throw new Error(result?.message || 'API ส่งข้อมูลกลับมาไม่ถูกต้อง');
    }

    return {
        news: Array.isArray(result.news)
            ? result.news.map(normalizeNewsItem).filter(item => item.title)
            : [],
        documents: Array.isArray(result.documents)
            ? result.documents.map(normalizeDocumentItem).filter(item => item.name)
            : [],
        stats: Array.isArray(result.stats)
            ? result.stats.map(normalizeStatsItem).filter(item => item.title)
            : []
    };
}

async function fetchJson(url) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONFIG.requestTimeoutMs);

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            signal: controller.signal
        });

        if (!response.ok) {
            throw new Error(`เรียก API ไม่สำเร็จ (${response.status})`);
        }

        return await response.json();
    } catch (error) {
        if (error.name === 'AbortError') {
            throw new Error('API ใช้เวลาตอบกลับนานเกินไป');
        }
        throw error;
    } finally {
        clearTimeout(timeoutId);
    }
}

function applyData(data) {
    // ข่าวเรียงใหม่ไปเก่า ส่วนเอกสารและสถิติใช้ลำดับจาก API
    localNewsData = [...data.news].reverse();
    localDocsData = [...data.documents];
    localStatsData = [...data.stats];
    filteredNews = [...localNewsData];
    filteredDocs = [...localDocsData];
}

function renderAllPages() {
    setupCategoryFilters();
    renderHomePage();
    renderNewsPage();
    renderDocumentsPage();
    renderStatsPage();
}

function setDataStatus(message = '', type = 'info') {
    const status = document.getElementById('data-status');
    const styles = {
        info: 'bg-blue-50 border-blue-200 text-blue-800',
        warning: 'bg-amber-50 border-amber-200 text-amber-800',
        error: 'bg-red-50 border-red-200 text-red-800'
    };

    status.className = `max-w-7xl w-[calc(100%-2rem)] mx-auto mt-4 px-4 py-3 rounded-xl border text-sm ${styles[type] || styles.info}`;
    status.textContent = message;
    status.classList.toggle('hidden', !message);
}

// ฟังก์ชันระบบสลับหน้า (Single Page Application Router)
function navigate(pageId) {
    if (!VALID_PAGES.has(pageId)) {
        pageId = 'home';
    }

    // ซ่อนทุกหน้าของระบบ
    document.querySelectorAll('.page-section').forEach(section => {
        section.classList.add('hidden');
    });
    
    // ดึงแสดงหน้าเป้าหมาย
    const targetPage = document.getElementById('page-' + pageId);
    if (targetPage) {
        targetPage.classList.remove('hidden');
    }
    
    // ปรับเปลี่ยนสีแถบเมนูในคอมพิวเตอร์ให้ตรงกับหน้าที่เลือกปัจจุบัน
    document.querySelectorAll('.nav-link').forEach(link => {
        if (link.getAttribute('data-target') === pageId) {
            link.classList.add('active');
        } else {
            link.classList.remove('active');
        }
    });

    // ปรับแถบเมนูแสดงในมือถือให้ตรงกับที่เลือก
    document.querySelectorAll('.nav-link-mobile').forEach(link => {
        if (link.getAttribute('data-target') === pageId) {
            link.classList.add('active');
        } else {
            link.classList.remove('active');
        }
    });

    // ซ่อนเมนูด้านข้างอัตโนมัติหากมีหน้าจอมือถือเปิดค้างไว้
    const mobileMenu = document.getElementById('mobile-menu');
    if (mobileMenu && !mobileMenu.classList.contains('hidden')) {
        mobileMenu.classList.add('hidden');
    }

    // เลื่อนแถบหน้าจอขึ้นไปบนสุด
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ================= สวิตช์โหมดไว้อาลัย (Mourning Mode Toggle) =================
// ค่าเริ่มต้นมาจาก <html class="mourning"> ใน index.html และจำค่าที่ผู้เข้าชมเลือกไว้ใน localStorage
function updateMourningToggles() {
    const isOn = document.documentElement.classList.contains('mourning');
    document.querySelectorAll('.mourning-toggle').forEach(btn => {
        btn.setAttribute('aria-checked', String(isOn));
        btn.title = isOn ? 'ปิดโหมดไว้อาลัย (แสดงสีปกติ)' : 'เปิดโหมดไว้อาลัย (โทนสีเทา)';
    });
}

function toggleMourningMode() {
    const isOn = document.documentElement.classList.toggle('mourning');
    try {
        localStorage.setItem('mourningMode', isOn ? 'on' : 'off');
    } catch {
        // เบราว์เซอร์ไม่อนุญาตให้บันทึก — สลับได้เฉพาะหน้านี้
    }
    updateMourningToggles();
}

document.querySelectorAll('.mourning-toggle').forEach(btn => {
    btn.addEventListener('click', toggleMourningMode);
});
updateMourningToggles();

// เพิ่มเงาให้หัวหน้าที่ล็อกไว้ เมื่อเนื้อหาเลื่อนผ่านด้านล่าง
function updateStickyHeaders() {
    const navHeight = document.querySelector('nav')?.offsetHeight || 80;
    document.querySelectorAll('.page-header').forEach(header => {
        const isStuck = header.offsetParent !== null && header.getBoundingClientRect().top <= navHeight + 1 && window.scrollY > 0;
        header.classList.toggle('is-stuck', isStuck);
    });
}
window.addEventListener('scroll', updateStickyHeaders, { passive: true });

// ================= Footer แบบย่อ/ขยายบนมือถือ =================
document.getElementById('footer-toggle')?.addEventListener('click', function () {
    const isOpen = this.getAttribute('aria-expanded') === 'true';
    // คลาส hidden มีผลเฉพาะมือถือ จอคอมใช้ md:contents / md:flex แสดงตลอด
    document.querySelectorAll('.footer-collapsible').forEach(el => el.classList.toggle('hidden', isOpen));
    this.setAttribute('aria-expanded', String(!isOpen));
    document.getElementById('footer-toggle-label').textContent = isOpen ? 'เพิ่มเติม' : 'ซ่อน';
    this.querySelector('.footer-chevron')?.classList.toggle('rotate-180', !isOpen);
    if (!isOpen) {
        document.getElementById('footer-more').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
});

// จัดการกดปุ่มเมนูบนแถบมือถือ
document.getElementById('mobile-menu-btn').addEventListener('click', function() {
    document.getElementById('mobile-menu').classList.toggle('hidden');
});

// ดึงชุดข้อมูลทั้งหมดเมื่อเปิดหน้าเว็บ
document.addEventListener('DOMContentLoaded', () => {
    navigate('home');
    renderHero(); // แสดงภาพพื้นหลังส่วนหัวทันที ไม่ต้องรอข้อมูลจาก API
    setDataStatus('กำลังโหลดข้อมูลจากระบบ…', 'info');
    initiateDataFetch();
});

async function initiateDataFetch() {
    try {
        // ตรวจเช็คว่าผู้ใช้ติดตั้ง API จริงหรือยัง หากไม่มีจะรัน Mock Data สวยๆ รอไว้
        if (CONFIG.apiUrl.includes("YOUR_WEB_APP_ID")) {
            console.warn("ระบบกำลังทำงานในโหมดโชว์หน้าจำลอง เนื่องจากยังไม่ได้เชื่อมโยง API Key");
            activateMockMode();
            return;
        }

        const result = await fetchJson(CONFIG.apiUrl);
        const data = normalizeApiResponse(result);
        applyData(data);
        renderAllPages();
        setDataStatus(
            Array.isArray(result.stats)
                ? ''
                : 'API ยังไม่ได้ส่งชุดข้อมูล stats กรุณาตรวจสอบ Google Apps Script และ Deploy เวอร์ชันล่าสุด',
            'warning'
        );
    } catch (error) {
        console.error("การโหลดข้อมูลผ่าน API ผิดพลาด:", error);
        // ใช้ข้อมูลจำลองเฉพาะตอนพัฒนา ไม่ซ่อนข้อผิดพลาดของระบบจริง
        applyData({ news: [], documents: [], stats: [] });
        renderAllPages();
        setDataStatus(`ไม่สามารถโหลดข้อมูลได้: ${error.message}`, 'error');
    }
}

// ตั้งค่าตัวเลือกหมวดหมู่เอกสารให้สร้างรายการกรองอัตโนมัติจากในชีท
function setupCategoryFilters() {
    const selectFilter = document.getElementById('doc-category-filter');
    const categories = [...new Set(localDocsData.map(doc => doc.category).filter(Boolean))];

    // คงตัวเลือก "ทั้งหมด" ไว้เพียงรายการเดียวเมื่อโหลดข้อมูลใหม่
    selectFilter.options.length = 1;
    
    categories.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.innerText = cat;
        selectFilter.appendChild(opt);
    });
}

// ================= เรนเดอร์หน้าแรก (Home Rendering) =================
function renderHomePage() {
    renderHero();

    // 1. ข่าวเด่น 1 ชิ้น (ภาพใหญ่) + ข่าวรอง 2 ชิ้น
    const newsContainer = document.getElementById('home-news-container');
    const latestNews = localNewsData.slice(0, 3);

    if (latestNews.length === 0) {
        newsContainer.innerHTML = emptyStateHtml('ไม่มีประกาศข่าวในตอนนี้', 'megaphone');
    } else {
        newsContainer.innerHTML = latestNews.map((item, index) => {
            const link = safeUrl(item.link);
            const tag = link ? 'a' : 'div';
            const linkAttrs = link ? `href="${escapeHtml(link)}" target="_blank" rel="noopener"` : '';
            const meta = `
                <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
                    ${getNewsBadge(item.type)}
                    <span class="text-xs text-slate-400 flex items-center font-medium"><i data-lucide="calendar" class="w-3.5 h-3.5 mr-1 text-slate-300"></i> ${escapeHtml(item.date) || '-'}</span>
                </div>`;
            const more = link ? `
                <span class="mt-4 text-blue-700 group-hover:text-blue-900 text-xs font-bold flex items-center">
                    อ่านรายละเอียดเพิ่มเติม <i data-lucide="external-link" class="w-3.5 h-3.5 ml-1"></i>
                </span>` : '';

            // ข่าวเด่น: ภาพซ้าย-เนื้อหาขวา บนจอใหญ่
            if (index === 0) {
                return `
                    <${tag} ${linkAttrs} class="group col-span-full bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-lg transition-all overflow-hidden grid grid-cols-1 md:grid-cols-5">
                        <div class="md:col-span-3 relative">
                            ${newsCover(item, 'aspect-video md:aspect-auto md:h-full md:min-h-[260px]', false)}
                            <span class="absolute top-3 left-3 bg-amber-500 text-slate-950 text-xs font-bold px-3 py-1 rounded-full shadow flex items-center">
                                <i data-lucide="star" class="w-3.5 h-3.5 mr-1"></i> ข่าวล่าสุด
                            </span>
                        </div>
                        <div class="md:col-span-2 p-6 flex flex-col justify-center">
                            ${meta}
                            <h3 class="font-bold text-slate-800 text-lg md:text-xl leading-relaxed break-words line-clamp-4">${escapeHtml(item.title)}</h3>
                            ${more}
                        </div>
                    </${tag}>`;
            }

            return `
                <${tag} ${linkAttrs} class="group bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all overflow-hidden flex flex-col h-full hover:-translate-y-1">
                    ${newsCover(item)}
                    <div class="p-5 flex flex-col flex-grow">
                        ${meta}
                        <h3 class="font-bold text-slate-800 text-md leading-relaxed break-words line-clamp-3 flex-grow">${escapeHtml(item.title)}</h3>
                        ${more}
                    </div>
                </${tag}>`;
        }).join('');
    }

    // 2. เอกสารล่าสุด 5 รายการ พร้อมภาพย่อหน้าแรกของไฟล์
    const docsContainer = document.getElementById('home-docs-container');
    const latestDocs = localDocsData.slice(0, 5);

    if (latestDocs.length === 0) {
        docsContainer.innerHTML = `<li class="text-center text-slate-400 text-sm py-4">ไม่มีเอกสารอัปโหลดด่วน</li>`;
    } else {
        docsContainer.innerHTML = latestDocs.map(doc => {
            const targetLink = safeUrl(doc.link1 || doc.link2);
            const visual = getFileVisual(doc.type1 || doc.type2);
            return `
                <li class="flex items-center justify-between p-2.5 rounded-xl border border-slate-100 hover:bg-slate-50 transition-colors">
                    <div class="flex items-center min-w-0 mr-2">
                        <div class="w-11 flex-shrink-0 rounded-md overflow-hidden border border-slate-200 shadow-sm mr-3">
                            ${coverHtml({ src: doc.cover, alt: doc.name, icon: visual.icon, bg: visual.bg, sizeClass: 'h-14 cover-mini' })}
                        </div>
                        <div class="min-w-0">
                            <p class="text-xs font-bold text-slate-700 break-words leading-relaxed line-clamp-2">${escapeHtml(doc.name)}</p>
                            <p class="text-[10px] text-slate-400 mt-0.5">${escapeHtml(doc.category || 'แบบฟอร์มหลัก')}</p>
                        </div>
                    </div>
                    ${targetLink ? `
                    <a href="${escapeHtml(targetLink)}" target="_blank" rel="noopener" class="p-2 bg-blue-50 hover:bg-blue-600 text-blue-600 hover:text-white rounded-lg transition-colors flex-shrink-0 ml-1" title="ดาวน์โหลดด่วน">
                        <i data-lucide="download" class="w-4 h-4"></i>
                    </a>` : ''}
                </li>`;
        }).join('');
    }
    lucide.createIcons();
}

// ================= เรนเดอร์หน้าข่าวสาร 3x3 พร้อมสลับหน้า (News Pagination Render) =================
function renderNewsPage() {
    const gridContainer = document.getElementById('news-grid-container');

    // ตรวจนับจำนวนไอเท็มทั้งหมดที่จะเอามาตัดแบ่งจัดหน้า
    const totalItems = filteredNews.length;
    if (totalItems === 0) {
        gridContainer.innerHTML = emptyStateHtml('ไม่พบประกาศข่าวประชาสัมพันธ์ที่ค้นหา', 'search-x');
        document.getElementById('news-pagination').innerHTML = '';
        lucide.createIcons();
        return;
    }

    // คำนวณช่วงข้อมูล (Slice Range)
    const startIndex = (newsCurrentPage - 1) * newsItemsPerPage;
    const endIndex = Math.min(startIndex + newsItemsPerPage, totalItems);
    const pageItems = filteredNews.slice(startIndex, endIndex);

    // จัดแสดงตามกล่องข่าว Grid 3x3 (ภาพปกด้านบน เนื้อหาด้านล่าง)
    gridContainer.innerHTML = pageItems.map(item => {
        const link = safeUrl(item.link);
        return `
            <div class="bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all flex flex-col overflow-hidden hover:-translate-y-1">
                ${link ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener" class="block">${newsCover(item)}</a>` : newsCover(item)}
                <div class="p-5 flex flex-col flex-grow">
                    <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
                        ${getNewsBadge(item.type)}
                        <span class="text-xs text-slate-400 flex items-center font-medium"><i data-lucide="calendar" class="w-4 h-4 mr-1 text-slate-300"></i> ${escapeHtml(item.date) || '-'}</span>
                    </div>
                    <h3 class="font-bold text-slate-800 text-md leading-relaxed break-words flex-grow">${escapeHtml(item.title)}</h3>
                    ${link ? `
                    <a href="${escapeHtml(link)}" target="_blank" rel="noopener" class="w-fit mt-4 text-blue-700 hover:text-blue-900 text-sm font-bold flex items-center hover:underline">
                        อ่านประกาศฉบับเต็ม <i data-lucide="external-link" class="w-4 h-4 ml-1"></i>
                    </a>` : `<div class="text-slate-300 text-xs mt-4">ไม่มีลิงก์แนบ</div>`}
                </div>
            </div>`;
    }).join('');

    // สร้างปุ่มสลับหน้าด้านล่าง (Footer Pagination)
    const totalPages = Math.ceil(totalItems / newsItemsPerPage);
    buildPaginationFooter('news-pagination', totalPages, newsCurrentPage, (clickedPage) => {
        newsCurrentPage = clickedPage;
        renderNewsPage();
        window.scrollTo({ top: document.getElementById('page-news').offsetTop - 90, behavior: 'smooth' });
    });

    lucide.createIcons();
}

// จัดการค้นหาข่าว
function handleNewsSearch() {
    const query = document.getElementById('news-search').value.toLowerCase().trim();
    if (query === '') {
        filteredNews = [...localNewsData];
    } else {
        filteredNews = localNewsData.filter(news => news.title.toLowerCase().includes(query));
    }
    newsCurrentPage = 1; // เริ่มนับหนึ่งใหม่ทุกครั้งที่พิมพ์ค้นหา
    renderNewsPage();
}

// ================= เรนเดอร์หน้าดาวน์โหลดเอกสาร 3x3 (Documents Render & Double Button) =================
function renderDocumentsPage() {
    const gridContainer = document.getElementById('doc-grid-container');

    const totalItems = filteredDocs.length;
    if (totalItems === 0) {
        gridContainer.innerHTML = emptyStateHtml('ไม่พบเอกสารดาวน์โหลดในหมวดหมู่ที่ระบุ', 'folder-open');
        document.getElementById('doc-pagination').innerHTML = '';
        lucide.createIcons();
        return;
    }

    // คำนวณขอบเขตหน้า Grid 3x3
    const startIndex = (docCurrentPage - 1) * docItemsPerPage;
    const endIndex = Math.min(startIndex + docItemsPerPage, totalItems);
    const pageItems = filteredDocs.slice(startIndex, endIndex);

    // วนลูปแสดงผลเอกสารแต่ละรายการ
    gridContainer.innerHTML = pageItems.map(doc => {
        const link1 = safeUrl(doc.link1);
        const link2 = safeUrl(doc.link2);

        // จัดเตรียมปุ่มดาวน์โหลด HTML
        let downloadButtonsHTML = '';

        // เคสที่ 1: มีทั้งสองลิงก์ (ปุ่มดาวน์โหลดคู่ PDF / Word-Excel)
        if (link1 && link2) {
            const btn1Style = getButtonStyle(doc.type1 || 'PDF');
            const btn2Style = getButtonStyle(doc.type2 || 'Word');

            downloadButtonsHTML = `
                <div class="grid grid-cols-2 gap-2 mt-4">
                    <a href="${escapeHtml(link1)}" target="_blank" rel="noopener" class="${btn1Style.class} flex items-center justify-center py-2.5 px-3 rounded-xl font-bold text-xs transition-colors hover:scale-[1.02] duration-150">
                        <i data-lucide="${btn1Style.icon}" class="w-4 h-4 mr-1.5 flex-shrink-0"></i> โหลด ${escapeHtml(btn1Style.label)}
                    </a>
                    <a href="${escapeHtml(link2)}" target="_blank" rel="noopener" class="${btn2Style.class} flex items-center justify-center py-2.5 px-3 rounded-xl font-bold text-xs transition-colors hover:scale-[1.02] duration-150">
                        <i data-lucide="${btn2Style.icon}" class="w-4 h-4 mr-1.5 flex-shrink-0"></i> โหลด ${escapeHtml(btn2Style.label)}
                    </a>
                </div>`;
        }
        // เคสที่ 2: มีเพียงลิงก์เดียว
        else if (link1 || link2) {
            const targetLink = link1 || link2;
            const btnStyle = getButtonStyle((link1 ? doc.type1 : doc.type2) || 'ไฟล์เอกสาร');

            downloadButtonsHTML = `
                <div class="mt-4">
                    <a href="${escapeHtml(targetLink)}" target="_blank" rel="noopener" class="${btnStyle.class} w-full flex items-center justify-center py-3 px-4 rounded-xl font-bold text-xs transition-all hover:scale-[1.01] duration-150">
                        <i data-lucide="${btnStyle.icon}" class="w-4 h-4 mr-1.5"></i> ดาวน์โหลดไฟล์ ${escapeHtml(btnStyle.label)}
                    </a>
                </div>`;
        } else {
            downloadButtonsHTML = `
                <div class="mt-4 py-2.5 text-center text-slate-300 border border-dashed border-slate-100 rounded-xl text-xs font-semibold">
                    ไม่มีไฟล์สำหรับดาวน์โหลด
                </div>`;
        }

        const previewLink = link1 || link2;
        const cover = docCover(doc);
        return `
            <div class="bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all flex flex-col overflow-hidden hover:-translate-y-1">
                <div class="relative border-b border-slate-200">
                    ${previewLink ? `<a href="${escapeHtml(previewLink)}" target="_blank" rel="noopener" class="block" title="เปิดดูตัวอย่างเอกสาร">${cover}</a>` : cover}
                    <span class="absolute top-3 left-3 bg-white/95 text-slate-700 px-2.5 py-1 rounded-lg text-[11px] font-bold border border-slate-200 shadow-sm">${escapeHtml(doc.category || 'แบบฟอร์ม')}</span>
                </div>
                <div class="p-5 flex flex-col flex-grow">
                    <h3 class="font-bold text-slate-800 text-sm leading-relaxed break-words flex-grow">${escapeHtml(doc.name)}</h3>
                    ${downloadButtonsHTML}
                </div>
            </div>`;
    }).join('');

    // สร้าง Pagination
    const totalPages = Math.ceil(totalItems / docItemsPerPage);
    buildPaginationFooter('doc-pagination', totalPages, docCurrentPage, (clickedPage) => {
        docCurrentPage = clickedPage;
        renderDocumentsPage();
        window.scrollTo({ top: document.getElementById('page-documents').offsetTop - 90, behavior: 'smooth' });
    });

    lucide.createIcons();
}

// คืนค่ารูปแบบสไตล์ปุ่มตามนามสกุลไฟล์
function getButtonStyle(format) {
    const f = format.toUpperCase();
    if (f.includes('PDF')) {
        return { class: "bg-red-50 hover:bg-red-600 text-red-600 hover:text-white border border-red-200 hover:border-transparent", icon: "file-text", label: "PDF" };
    } else if (f.includes('XLS') || f.includes('EXCEL') || f.includes('CSV')) {
        return { class: "bg-emerald-50 hover:bg-emerald-600 text-emerald-600 hover:text-white border border-emerald-200 hover:border-transparent", icon: "file-spreadsheet", label: "Excel" };
    } else if (f.includes('DOC') || f.includes('WORD')) {
        return { class: "bg-blue-50 hover:bg-blue-600 text-blue-600 hover:text-white border border-blue-200 hover:border-transparent", icon: "file-type-2", label: "Word" };
    }
    return { class: "bg-slate-100 hover:bg-slate-700 text-slate-700 hover:text-white border border-slate-200 hover:border-transparent", icon: "download", label: format };
}

// จัดการคลิกกรองหมวดหมู่เอกสาร
function handleDocFilter() {
    const cat = document.getElementById('doc-category-filter').value;
    if (cat === '') {
        filteredDocs = [...localDocsData];
    } else {
        filteredDocs = localDocsData.filter(doc => doc.category === cat);
    }
    docCurrentPage = 1;
    renderDocumentsPage();
}

// ================= เรนเดอร์หน้าข้อมูลสถิติ (Statistics Render) =================
function renderStatsPage() {
    const container = document.getElementById('stats-grid-container');

    if (localStatsData.length === 0) {
        container.innerHTML = emptyStateHtml('ไม่มีข้อมูลรายงานสถิติแสดงในขณะนี้', 'bar-chart-2');
        lucide.createIcons();
        return;
    }

    container.innerHTML = localStatsData.map(stat => {
        const link = safeUrl(stat.link);
        return `
            <div class="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm flex flex-col justify-between hover:shadow-md transition-all">
                <div>
                    <div class="border-b border-slate-200">
                        ${coverHtml({ src: stat.imageUrl, alt: stat.title, icon: 'bar-chart-3', label: 'รายงานเชิงสรุป', sizeClass: 'h-56', position: 'object-center' })}
                    </div>
                    <div class="p-6">
                        <h3 class="font-bold text-slate-800 text-lg mb-2">${escapeHtml(stat.title)}</h3>
                        <p class="text-slate-500 text-sm leading-relaxed mb-4 break-words">${escapeHtml(stat.description || 'ไม่มีคำอธิบายประกอบเพิ่มเติม')}</p>
                    </div>
                </div>
                ${link ? `
                <div class="px-6 pb-6 pt-2 border-t border-slate-100 mt-2">
                    <a href="${escapeHtml(link)}" target="_blank" rel="noopener" class="w-full bg-blue-900 hover:bg-slate-900 text-white text-center py-3 px-4 rounded-xl font-bold text-xs transition-colors flex items-center justify-center hover:scale-[1.01]">
                        <i data-lucide="search" class="w-4 h-4 mr-1.5"></i> เปิด
                    </a>
                </div>` : ''}
            </div>`;
    }).join('');
    lucide.createIcons();
}

// ================= ฟังก์ชันส่วนเสริมสนับสนุนการสร้างปุ่มจัดหน้าเว็บ (Helper Pagination Generator) =================
function buildPaginationFooter(elementId, totalPages, currentPage, onPageClick) {
    const pagContainer = document.getElementById(elementId);
    pagContainer.innerHTML = '';

    if (totalPages <= 1) return; // หากมีข้อมูลจำนวนน้อยกว่า 9 ไม่จำเป็นต้องแสดงปุ่มสลับหน้า

    // ปุ่มย้อนกลับ (Previous Button)
    const prevBtn = document.createElement('button');
    prevBtn.className = `p-2 rounded-lg border ${currentPage === 1 ? 'text-slate-300 border-slate-100 cursor-not-allowed' : 'text-blue-900 border-slate-200 hover:bg-slate-100'}`;
    prevBtn.innerHTML = `<i data-lucide="chevron-left" class="w-4 h-4"></i>`;
    if (currentPage > 1) {
        prevBtn.addEventListener('click', () => onPageClick(currentPage - 1));
    }
    pagContainer.appendChild(prevBtn);

    // ปุ่มตัวเลขแต่ละหน้า
    for (let i = 1; i <= totalPages; i++) {
        const numBtn = document.createElement('button');
        numBtn.className = `w-10 h-10 rounded-lg text-sm font-bold border transition-colors ${i === currentPage ? 'bg-blue-900 text-white border-transparent' : 'text-slate-600 border-slate-200 hover:bg-slate-100'}`;
        numBtn.innerText = i;
        numBtn.addEventListener('click', () => onPageClick(i));
        pagContainer.appendChild(numBtn);
    }

    // ปุ่มสลับไปข้างหน้า (Next Button)
    const nextBtn = document.createElement('button');
    nextBtn.className = `p-2 rounded-lg border ${currentPage === totalPages ? 'text-slate-300 border-slate-100 cursor-not-allowed' : 'text-blue-900 border-slate-200 hover:bg-slate-100'}`;
    nextBtn.innerHTML = `<i data-lucide="chevron-right" class="w-4 h-4"></i>`;
    if (currentPage < totalPages) {
        nextBtn.addEventListener('click', () => onPageClick(currentPage + 1));
    }
    pagContainer.appendChild(nextBtn);

    lucide.createIcons();
}

// ================= โหมดรันระบบจำลองที่ปลอดภัยสูง (Safe Mock Data Mode) =================
function activateMockMode() {
    setTimeout(() => {
        localNewsData = [
            { id: 1, title: "กำหนดการตรวจสอบผลการเรียน ภาคเรียนที่ 1 ประจำปีการศึกษา 2567 สำหรับนักเรียนทุกระดับชั้นและทุกแผนกวิชา", date: "20 พ.ค. 2567", type: "ประกาศ", link: "#" },
            { id: 2, title: "แจ้งคุณครูผู้สอนกำหนดส่งคะแนน ปพ.5 ระบบออนไลน์ ภายในวันที่ 30 มีนาคมนี้ เพื่อสอดคล้องกับนโยบายใหม่ของฝ่ายวิชาการ", date: "15 มี.ค. 2567", type: "ด่วน", link: "#" },
            { id: 3, title: "กำหนดการลงทะเบียนเรียนซ้ำ และสอบแก้ตัว ครั้งที่ 1 และครั้งที่ 2 สำหรับทุกระดับชั้น ณ ห้องงานวัดผลและประเมินผล อาคารเรียนหลัก", date: "10 มี.ค. 2567", type: "ประกาศ", link: "#" },
            { id: 4, title: "คู่มือการสมัครสอบแก้ตัวด้วยตนเองแบบออนไลน์ ประจำปีการศึกษา 2567 ขั้นตอนอย่างละเอียดพร้อมระบบวิดีโออธิบายการทำงาน", date: "05 มี.ค. 2567", type: "ข่าวสาร", link: "#" },
            { id: 5, title: "เชิญเข้าร่วมสัมมนาแนะแนวการวัดผลหลักสูตรฐานสมรรถนะใหม่ สำหรับครูวิชาการระดับ ม.ต้น และคณะกรรมการดำเนินงาน", date: "28 ก.พ. 2567", type: "ข่าวสาร", link: "#" }
        ];
        
        localDocsData = [
            { id: 1, name: "แบบฟอร์ม ปพ.5 บันทึกผลการพัฒนาคุณภาพผู้เรียน (ประจำห้องเรียนและรายกลุ่มสาระวิชาพื้นฐาน)", category: "แบบฟอร์มครูผู้สอน", link1: "#", type1: "Excel", link2: "#", type2: "Word" },
            { id: 2, name: "คำร้องขอสอบแก้ตัวสำหรับนักเรียนที่มีผลการเรียนเป็น ร, มส, 0 ทุกกรณี เพื่อนำเสนอขออนุมัติต่อฝ่ายวิชาการ", category: "แบบฟอร์มนักเรียน", link1: "#", type1: "PDF", link2: "#", type2: "Word" },
            { id: 3, name: "คู่มือแนวทางการทำงานวัดผลและประเมินผลกลุ่มวิชาการ ฉบับใหม่ ครอบคลุมการวัดผลตามมาตรฐานสมรรถนะผู้เรียน", category: "คู่มือการเรียนการสอน", link1: "#", type1: "PDF" },
            { id: 4, name: "ปฏิทินปฏิบัติการฝ่ายวิชาการและงานวัดผล ประจำปีการศึกษา 2567 ตารางกิจกรรมตลอดทั้งสองภาคเรียนอย่างสมบูรณ์", category: "กำหนดการ", link1: "#", type1: "PDF" },
            { id: 5, name: "แบบฟอร์มขอส่งแก้ไขผลการเรียนและคะแนนสะสมรายห้องเรียน (กรณีคุณครูส่งผลคะแนนตกหล่นหรือมีการแก้ไขภายหลัง)", category: "แบบฟอร์มครูผู้สอน", link1: "#", type1: "Word" }
        ];

        localStatsData = [
            { id: 1, title: "สถิติอัตราส่วนเกรดเฉลี่ยรายภาคเรียน 1/2567", description: "แผนภูมิความถี่ปริมาณการได้เกรด 4 ของทุกระดับชั้นเรียนแยกตามกลุ่มสาระการเรียนรู้", link: "#", imageUrl: "https://placehold.co/600x400/1e3a8a/ffffff?text=Academic+Results" },
            { id: 2, title: "รายงานผลสัมฤทธิ์ระดับโรงเรียน ประจำปีการศึกษา 2566", description: "เอกสารรายงานสรุปส่งออกไปยังสำนักงานเขตพื้นที่การศึกษามัธยมศึกษา มีข้อมูลครบถ้วน", link: "#", imageUrl: "https://placehold.co/600x400/1e3a8a/ffffff?text=Annual+Report" }
        ];

        localNewsData = localNewsData.map(normalizeNewsItem);
        localDocsData = localDocsData.map(normalizeDocumentItem);
        localStatsData = localStatsData.map(normalizeStatsItem);
        filteredNews = [...localNewsData];
        filteredDocs = [...localDocsData];

        setupCategoryFilters();
        renderHomePage();
        renderNewsPage();
        renderDocumentsPage();
        renderStatsPage();
    }, 500);
}


