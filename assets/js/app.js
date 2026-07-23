// เรียกใช้งานชุดไอคอนของ Lucide
lucide.createIcons();

// 🔗 URL ปลายทางของ Google Apps Script Web App (API ดักข้อมูลจาก Sheet)
// **ให้นำรหัส Web App ID ที่ได้จากการสั่งเผยแพร่มาวางในเครื่องหมายคำพูดด้านล่างนี้ได้เลยครับ**
const CONFIG = Object.freeze({
    apiUrl: "https://script.google.com/macros/s/AKfycbxKpd52p4VWbwA70ZCsfyBrmy5gqn0UmqBnGR3uUptunSk8e4RasE8IoKq_60JfqQyuig/exec",
    requestTimeoutMs: 15000
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

function normalizeNewsItem(item = {}) {
    return {
        title: asText(item.title),
        date: asText(item.date),
        type: asText(item.type),
        link: asText(item.link)
    };
}

function normalizeDocumentItem(item = {}) {
    return {
        name: asText(item.name),
        category: asText(item.category),
        link1: asText(item.link1),
        type1: asText(item.type1),
        link2: asText(item.link2),
        type2: asText(item.type2)
    };
}

function normalizeImageUrl(value) {
    const imageUrl = asText(value);
    if (!imageUrl || imageUrl === '#') return '';

    // แปลงลิงก์หน้า Preview/Share ของ Google Drive เป็นลิงก์รูปสำหรับ <img>
    const drivePatterns = [
        /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/,
        /drive\.google\.com\/(?:open|uc)\?(?:[^#]*&)?id=([a-zA-Z0-9_-]+)/,
        /[?&]id=([a-zA-Z0-9_-]+)/
    ];

    for (const pattern of drivePatterns) {
        const match = imageUrl.match(pattern);
        if (match) {
            return `https://drive.google.com/thumbnail?id=${encodeURIComponent(match[1])}&sz=w1200`;
        }
    }

    // ป้องกันค่าที่ไม่ใช่ URL ถูกนำไปใช้เป็น src
    try {
        const parsedUrl = new URL(imageUrl);
        return ['http:', 'https:'].includes(parsedUrl.protocol) ? parsedUrl.href : '';
    } catch {
        return '';
    }
}

function normalizeStatsItem(item = {}) {
    return {
        title: asText(item.title),
        description: asText(item.description),
        link: asText(item.link),
        imageUrl: normalizeImageUrl(item.imageUrl || item.imageURL || item.image)
    };
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

// จัดการกดปุ่มเมนูบนแถบมือถือ
document.getElementById('mobile-menu-btn').addEventListener('click', function() {
    document.getElementById('mobile-menu').classList.toggle('hidden');
});

// ดึงชุดข้อมูลทั้งหมดเมื่อเปิดหน้าเว็บ
document.addEventListener('DOMContentLoaded', () => {
    navigate('home');
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
    // 1. เรนเดอร์ข่าวสารล่าสุด 3 ชิ้นแรก
    const newsContainer = document.getElementById('home-news-container');
    newsContainer.innerHTML = '';
    
    const latestNews = localNewsData.slice(0, 3);
    if (latestNews.length === 0) {
        newsContainer.innerHTML = `<div class="col-span-full text-center text-slate-400 py-6">ไม่มีประกาศข่าวในตอนนี้</div>`;
    } else {
        latestNews.forEach(item => {
            let badgeColor = "bg-blue-100 text-blue-800 border-blue-200";
            if (item.type === "ด่วน") badgeColor = "bg-red-100 text-red-800 border-red-200";
            else if (item.type === "ข่าวสาร") badgeColor = "bg-emerald-100 text-emerald-800 border-emerald-200";

            const hasLink = item.link && item.link.trim() !== "" && item.link !== "#";
            const cardContent = `
                <div class="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm hover:shadow-md transition-shadow cursor-pointer flex flex-col justify-between h-full min-h-[160px]">
                    <div>
                        <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
                            <span class="px-2.5 py-1 rounded-lg text-xs font-bold border ${badgeColor}">${item.type || 'ประกาศ'}</span>
                            <span class="text-xs text-slate-400 flex items-center font-medium"><i data-lucide="calendar" class="w-3.5 h-3.5 mr-1 text-slate-300"></i> ${item.date || '-'}</span>
                        </div>
                        <h3 class="font-bold text-slate-800 text-md leading-relaxed break-words">${item.title}</h3>
                    </div>
                    ${hasLink ? `
                    <a href="${item.link}" target="_blank" class="mt-4 text-blue-700 hover:text-blue-900 text-xs font-bold flex items-center">
                        อ่านรายละเอียดเพิ่มเติม <i data-lucide="external-link" class="w-3.5 h-3.5 ml-1"></i>
                    </a>` : ''}
                </div>`;
            newsContainer.innerHTML += cardContent;
        });
    }

    // 2. เรนเดอร์เอกสารด่วนล่าสุด 3-5 รายการที่หน้าแรก
    const docsContainer = document.getElementById('home-docs-container');
    docsContainer.innerHTML = '';

    const latestDocs = localDocsData.slice(0, 5);
    if (latestDocs.length === 0) {
        docsContainer.innerHTML = `<li class="text-center text-slate-400 text-sm py-4">ไม่มีเอกสารอัปโหลดด่วน</li>`;
    } else {
        latestDocs.forEach(doc => {
            // ตรวจหานามสกุลไฟล์เพื่อติดไอคอนที่เหมาะสม
            let iconColor = "text-blue-500 bg-blue-50";
            let iconName = "file-text";
            
            const checkType = (doc.type1 || doc.size || '').toLowerCase();
            if (checkType.includes('pdf')) { iconColor = "text-red-500 bg-red-50"; iconName = "file-code-2"; }
            else if (checkType.includes('xls') || checkType.includes('excel')) { iconColor = "text-emerald-600 bg-emerald-50"; iconName = "table"; }
            else if (checkType.includes('doc') || checkType.includes('word')) { iconColor = "text-blue-600 bg-blue-50"; iconName = "file-type-2"; }

            // ดึงปุ่มดาวน์โหลดที่ใช้งานได้ปุ่มแรกมาโชว์หน้าแรก
            const targetLink = doc.link1 || doc.link || '#';

            docsContainer.innerHTML += `
                <li class="flex items-start justify-between p-3 rounded-xl border border-slate-100 hover:bg-slate-50 transition-colors">
                    <div class="flex items-start min-w-0 mr-2">
                        <div class="p-2 rounded-lg ${iconColor} mr-3 flex-shrink-0">
                            <i data-lucide="${iconName}" class="w-5 h-5"></i>
                        </div>
                        <div class="min-w-0">
                            <p class="text-xs font-bold text-slate-700 break-words leading-relaxed">${doc.name}</p>
                            <p class="text-[10px] text-slate-400 mt-0.5">${doc.category || 'แบบฟอร์มหลัก'}</p>
                        </div>
                    </div>
                    <a href="${targetLink}" target="_blank" class="p-2 bg-blue-50 hover:bg-blue-600 text-blue-600 hover:text-white rounded-lg transition-colors flex-shrink-0 ml-1" title="ดาวน์โหลดด่วน">
                        <i data-lucide="download" class="w-4 h-4"></i>
                    </a>
                </li>
            `;
        });
    }
    lucide.createIcons();
}

// ================= เรนเดอร์หน้าข่าวสาร 3x3 พร้อมสลับหน้า (News Pagination Render) =================
function renderNewsPage() {
    const gridContainer = document.getElementById('news-grid-container');
    gridContainer.innerHTML = '';

    // ตรวจนับจำนวนไอเท็มทั้งหมดที่จะเอามาตัดแบ่งจัดหน้า
    const totalItems = filteredNews.length;
    if (totalItems === 0) {
        gridContainer.innerHTML = `<div class="col-span-full py-20 text-center text-slate-400">ไม่พบประกาศข่าวประชาสัมพันธ์ที่ค้นหา</div>`;
        document.getElementById('news-pagination').innerHTML = '';
        return;
    }

    // คำนวณช่วงข้อมูล (Slice Range)
    const startIndex = (newsCurrentPage - 1) * newsItemsPerPage;
    const endIndex = Math.min(startIndex + newsItemsPerPage, totalItems);
    const pageItems = filteredNews.slice(startIndex, endIndex);

    // จัดแสดงตามกล่องข่าว Grid 3x3
    pageItems.forEach(item => {
        let badgeColor = "bg-blue-100 text-blue-800 border-blue-200";
        if (item.type === "ด่วน") badgeColor = "bg-red-100 text-red-800 border-red-200";
        else if (item.type === "ข่าวสาร") badgeColor = "bg-emerald-100 text-emerald-800 border-emerald-200";

        const hasLink = item.link && item.link.trim() !== "" && item.link !== "#";
        gridContainer.innerHTML += `
            <div class="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm hover:shadow-md transition-all flex flex-col justify-between min-h-[240px] hover:-translate-y-1">
                <div>
                    <div class="flex items-center justify-between mb-4 flex-wrap gap-2">
                        <span class="px-3 py-1 rounded-lg text-xs font-bold border ${badgeColor}">${item.type || 'ประกาศ'}</span>
                        <span class="text-xs text-slate-400 flex items-center font-medium"><i data-lucide="calendar" class="w-4 h-4 mr-1 text-slate-300"></i> ${item.date || '-'}</span>
                    </div>
                    <h3 class="font-bold text-slate-800 text-md leading-relaxed break-words">${item.title}</h3>
                </div>
                ${hasLink ? `
                <a href="${item.link}" target="_blank" class="w-fit mt-5 text-blue-700 hover:text-blue-900 text-sm font-bold flex items-center hover:underline">
                    อ่านประกาศฉบับเต็ม <i data-lucide="external-link" class="w-4 h-4 ml-1"></i>
                </a>` : `<div class="text-slate-300 text-xs mt-5">ไม่มีลิงก์แนบแนบ</div>`}
            </div>
        `;
    });

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
    gridContainer.innerHTML = '';

    const totalItems = filteredDocs.length;
    if (totalItems === 0) {
        gridContainer.innerHTML = `<div class="col-span-full py-20 text-center text-slate-400">ไม่พบเอกสารดาวน์โหลดในหมวดหมู่ที่ระบุ</div>`;
        document.getElementById('doc-pagination').innerHTML = '';
        return;
    }

    // คำนวณขอบเขตหน้า Grid 3x3
    const startIndex = (docCurrentPage - 1) * docItemsPerPage;
    const endIndex = Math.min(startIndex + docItemsPerPage, totalItems);
    const pageItems = filteredDocs.slice(startIndex, endIndex);

    // วนลูปแสดงผลเอกสารแต่ละรายการ
    pageItems.forEach(doc => {
        // วิเคราะห์ปุ่มดาวน์โหลด (กรณีมีไฟล์ PDF + Word/Excel ในคอลัมน์ของชีทเดียว)
        // ตรวจเช็คว่ามี link1 และ link2 หรือไม่ หากไม่มีจะมองหา link ธรรมดา
        const hasLink1 = doc.link1 && doc.link1.trim() !== "" && doc.link1 !== "#";
        const hasLink2 = doc.link2 && doc.link2.trim() !== "" && doc.link2 !== "#";
        const hasFallbackLink = doc.link && doc.link.trim() !== "" && doc.link !== "#";

        // จัดเตรียมปุ่มดาวน์โหลด HTML
        let downloadButtonsHTML = '';

        // เคสที่ 1: มีทั้งสองลิงก์ (ปุ่มดาวน์โหลดคู่ PDF / Word-Excel)
        if (hasLink1 && hasLink2) {
            const btn1Style = getButtonStyle(doc.type1 || 'PDF');
            const btn2Style = getButtonStyle(doc.type2 || 'Word');

            downloadButtonsHTML = `
                <div class="grid grid-cols-2 gap-2 mt-5">
                    <a href="${doc.link1}" target="_blank" class="${btn1Style.class} flex items-center justify-center py-2.5 px-3 rounded-xl font-bold text-xs transition-colors hover:scale-[1.02] duration-150">
                        <i data-lucide="${btn1Style.icon}" class="w-4 h-4 mr-1.5 flex-shrink-0"></i> โหลด ${btn1Style.label}
                    </a>
                    <a href="${doc.link2}" target="_blank" class="${btn2Style.class} flex items-center justify-center py-2.5 px-3 rounded-xl font-bold text-xs transition-colors hover:scale-[1.02] duration-150">
                        <i data-lucide="${btn2Style.icon}" class="w-4 h-4 mr-1.5 flex-shrink-0"></i> โหลด ${btn2Style.label}
                    </a>
                </div>
            `;
        }
        // เคสที่ 2: มีเพียงลิงก์เดียว หรือเป็นลิงก์เดี่ยวจากระบบเก่า
        else if (hasLink1 || hasFallbackLink) {
            const targetLink = hasLink1 ? doc.link1 : doc.link;
            const formatType = hasLink1 ? (doc.type1 || 'ไฟล์เอกสาร') : (doc.size || 'ไฟล์เอกสาร');
            const btnStyle = getButtonStyle(formatType);

            downloadButtonsHTML = `
                <div class="mt-5">
                    <a href="${targetLink}" target="_blank" class="${btnStyle.class} w-full flex items-center justify-center py-3 px-4 rounded-xl font-bold text-xs transition-all hover:scale-[1.01] duration-150">
                        <i data-lucide="${btnStyle.icon}" class="w-4 h-4 mr-1.5"></i> ดาวน์โหลดไฟล์ ${btnStyle.label}
                    </a>
                </div>
            `;
        } else {
            downloadButtonsHTML = `
                <div class="mt-5 py-2.5 text-center text-slate-300 border border-dashed border-slate-100 rounded-xl text-xs font-semibold">
                    ไม่มีไฟล์สำหรับดาวน์โหลด
                </div>
            `;
        }

        gridContainer.innerHTML += `
            <div class="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm hover:shadow-md transition-all flex flex-col justify-between hover:-translate-y-1 min-h-[190px]">
                <div class="flex-grow flex flex-col">
                    <div class="flex items-center justify-between mb-3">
                        <span class="bg-slate-100 text-slate-600 px-2.5 py-1 rounded-lg text-[11px] font-bold border border-slate-200">${doc.category || 'แบบฟอร์ม'}</span>
                    </div>
                    <h3 class="font-bold text-slate-800 text-sm leading-relaxed break-words mb-4 flex-grow">${doc.name}</h3>
                </div>
                ${downloadButtonsHTML}
            </div>
        `;
    });

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
        return { class: "bg-red-50 hover:bg-red-600 text-red-600 hover:text-white border border-red-200 hover:border-transparent", icon: "file-code-2", label: "PDF" };
    } else if (f.includes('XLS') || f.includes('EXCEL') || f.includes('CSV')) {
        return { class: "bg-emerald-50 hover:bg-emerald-600 text-emerald-600 hover:text-white border border-emerald-200 hover:border-transparent", icon: "table", label: "Excel" };
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
    container.innerHTML = '';

    if (localStatsData.length === 0) {
        container.innerHTML = `
            <div class="col-span-full bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-400">
                <i data-lucide="bar-chart-2" class="w-12 h-12 mx-auto mb-3 text-slate-300"></i>
                <p class="font-bold">ไม่มีข้อมูลรายงานสถิติแสดงในขณะนี้</p>
            </div>
        `;
        return;
    }

    localStatsData.forEach(stat => {
        const hasLink = stat.link && stat.link.trim() !== "" && stat.link !== "#";
        const hasImg = stat.imageUrl && stat.imageUrl.trim() !== "" && stat.imageUrl !== "#";

        container.innerHTML += `
            <div class="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm flex flex-col justify-between hover:shadow-md transition-all">
                <div>
                    ${hasImg ? `
                    <div class="h-48 overflow-hidden bg-slate-100 border-b border-slate-200 flex items-center justify-center">
                        <img src="${stat.imageUrl}" alt="${stat.title}" class="w-full h-full object-cover" loading="lazy" onerror="this.onerror=null;this.src='https://placehold.co/600x400/1e3a8a/ffffff?text=STATISTICS'">
                    </div>` : `
                    <div class="h-12 bg-blue-900 border-b border-slate-200 flex items-center justify-center text-amber-400">
                        <i data-lucide="bar-chart-2" class="w-5 h-5 mr-1.5"></i> รายงานเชิงสรุป
                    </div>`}
                    <div class="p-6">
                        <h3 class="font-bold text-slate-800 text-lg mb-2">${stat.title}</h3>
                        <p class="text-slate-500 text-sm leading-relaxed mb-4 break-words">${stat.description || 'ไม่มีคำอธิบายประกอบเพิ่มเติม'}</p>
                    </div>
                </div>
                ${hasLink ? `
                <div class="px-6 pb-6 pt-2 border-t border-slate-100 mt-2">
                    <a href="${stat.link}" target="_blank" class="w-full bg-blue-900 hover:bg-slate-900 text-white text-center py-3 px-4 rounded-xl font-bold text-xs transition-colors flex items-center justify-center hover:scale-[1.01]">
                        <i data-lucide="search" class="w-4 h-4 mr-1.5"></i> เปิด
                    </a>
                </div>` : ''}
            </div>
        `;
    });
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

        filteredNews = [...localNewsData];
        filteredDocs = [...localDocsData];

        setupCategoryFilters();
        renderHomePage();
        renderNewsPage();
        renderDocumentsPage();
        renderStatsPage();
    }, 500);
}
