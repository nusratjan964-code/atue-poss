/**
 * Drive2Social AI — Frontend Application Controller
 * Handles live overview stats, Google Drive library, AI Caption Studio, Queue, Social Accounts, and Settings.
 */

// ==============================================================================
// State
// ==============================================================================

let CURRENT_TAB = 'tab-overview';
let CURRENT_STUDIO_VIDEO = null;
let CURRENT_STUDIO_JOB_ID = null;
let CURRENT_STUDIO_ANALYSIS = null;
let ACTIVE_STUDIO_PLATFORM = 'youtube';

let DRIVE_PAGE = 1;
let DRIVE_FILTER = 'all';
let DRIVE_SEARCH = '';

// ==============================================================================
// Initialization
// ==============================================================================

document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initDashboardEvents();
  initDriveLibraryEvents();
  initStudioEvents();
  initQueueEvents();
  initAccountEvents();
  initSettingsEvents();

  // Initial load
  loadDashboardStats();
  loadDriveFiles(1);
  loadQueue();
  loadAccounts();
  loadSettings();

  // Auto poll dashboard stats every 15 seconds
  setInterval(loadDashboardStats, 15000);
});

// ==============================================================================
// 1. Navigation Controller
// ==============================================================================

function initNavigation() {
  const navBtns = document.querySelectorAll('.nav-item');
  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.dataset.tab;
      switchTab(targetTab);
    });
  });
}

function switchTab(tabId) {
  CURRENT_TAB = tabId;
  document.querySelectorAll('.nav-item').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tabId);
  });
  document.querySelectorAll('.tab-panel').forEach(p => {
    p.classList.toggle('active', p.id === tabId);
  });

  if (tabId === 'tab-overview') loadDashboardStats();
  if (tabId === 'tab-drive') loadDriveFiles(DRIVE_PAGE);
  if (tabId === 'tab-queue') loadQueue();
  if (tabId === 'tab-accounts') loadAccounts();
  if (tabId === 'tab-settings') loadSettings();
}

// ==============================================================================
// 2. Overview Dashboard
// ==============================================================================

function initDashboardEvents() {
  const btnTrigger = document.getElementById('btnQuickTrigger');
  const btnRefresh = document.getElementById('btnRefreshAll');
  const btnClearLogs = document.getElementById('btnClearActivityLogs');

  if (btnTrigger) {
    btnTrigger.addEventListener('click', triggerQuickProcess);
  }
  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => {
      loadDashboardStats();
      loadDriveFiles(1);
      loadQueue();
      showToast('সব ডেটা রিফ্রেশ করা হয়েছে!', 'info');
    });
  }
  if (btnClearLogs) {
    btnClearLogs.addEventListener('click', () => {
      const feed = document.getElementById('overviewActivityFeed');
      if (feed) feed.innerHTML = '<div class="feed-item system"><span class="f-time">[Live]</span> লগ ক্লিয়ার করা হয়েছে...</div>';
    });
  }
}

async function loadDashboardStats() {
  try {
    const res = await fetch('/api/stats/dashboard');
    const data = await res.json();
    if (!data.success) return;

    const { stats, systemStatus, recentActivity, recentPublished } = data;

    // Header pills
    document.getElementById('hdrDailyCount').textContent = `${stats.todayCount} / ${stats.dailyLimit}`;
    document.getElementById('hdrModeLabel').textContent = systemStatus.reviewMode ? 'Review Mode' : 'Auto Mode';
    document.getElementById('lblSidebarTz').textContent = systemStatus.timezone || 'Asia/Dhaka';

    // Live Health Badges
    const drivePill = document.getElementById('hdrDriveStatus');
    const driveLabel = document.getElementById('hdrDriveLabel');
    if (drivePill && driveLabel) {
      const dot = drivePill.querySelector('.dot-indicator');
      if (systemStatus.googleDriveAuthenticated) {
        if (dot) dot.className = 'dot-indicator green';
        driveLabel.textContent = systemStatus.googleAccountEmail ? `OAuth (${systemStatus.googleAccountEmail})` : 'Connected (OAuth)';
      } else if (stats.totalDriveVideos > 0) {
        if (dot) dot.className = 'dot-indicator gold';
        driveLabel.textContent = `Public Preview (${stats.totalDriveVideos})`;
      } else {
        if (dot) dot.className = 'dot-indicator red';
        driveLabel.textContent = 'Disconnected';
      }
    }

    const geminiPill = document.getElementById('hdrGeminiStatus');
    const geminiLabel = document.getElementById('hdrGeminiLabel');
    if (geminiPill && geminiLabel) {
      const dot = geminiPill.querySelector('.dot-indicator');
      if (systemStatus.geminiConnected) {
        if (dot) dot.className = 'dot-indicator purple';
        geminiLabel.textContent = systemStatus.geminiModel || 'Gemini Flash';
      } else {
        if (dot) dot.className = 'dot-indicator red';
        geminiLabel.textContent = 'Key Missing';
      }
    }

    // KPI Cards
    document.getElementById('kpiTodayCount').innerHTML = `${stats.todayCount} <span class="m-sub">/ ${stats.dailyLimit} ভিডিও</span>`;
    const pct = Math.min(100, Math.round((stats.todayCount / (stats.dailyLimit || 3)) * 100));
    document.getElementById('kpiTodayProgress').style.width = `${pct}%`;

    document.getElementById('kpiAwaitingApproval').innerHTML = `${stats.awaitingApprovalCount} <span class="m-sub">ভিডিও</span>`;
    document.getElementById('kpiTotalPublished').innerHTML = `${stats.totalPublishedCount} <span class="m-sub">টি পোস্ট</span>`;
    document.getElementById('kpiInQueue').innerHTML = `${stats.queueCount} <span class="m-sub">ভিডিও</span>`;
    document.getElementById('kpiTotalDriveVideos').innerHTML = `${stats.totalDriveVideos} <span class="m-sub">টি রিলস</span>`;
    document.getElementById('kpiFailedCount').innerHTML = `${stats.failedCount} <span class="m-sub">টি ত্রুটি</span>`;

    // Counts on sidebar nav
    document.getElementById('navDriveCount').textContent = stats.totalDriveVideos;
    document.getElementById('navQueueCount').textContent = stats.awaitingApprovalCount || stats.queueCount;

    // Activity feed
    renderActivityFeed(recentActivity);
    renderRecentPosts(recentPublished);
  } catch (err) {
    console.warn('[Dashboard] Stats fetch error:', err.message);
  }
}

function renderActivityFeed(logs = []) {
  const container = document.getElementById('overviewActivityFeed');
  if (!container || !Array.isArray(logs) || logs.length === 0) return;

  container.innerHTML = logs.map(item => {
    const time = new Date(item.timestamp).toLocaleTimeString('bn-BD', { hour12: false });
    return `<div class="feed-item ${item.type}"><span class="f-time">[${time}]</span> ${item.message}</div>`;
  }).join('');
}

function renderRecentPosts(posts = []) {
  const container = document.getElementById('overviewRecentPosts');
  if (!container) return;

  if (!posts || posts.length === 0) {
    container.innerHTML = '<div class="empty-state-mini">এখনও কোনো ভিডিও প্রকাশ করা হয়নি। উপরে "ভিডিও প্রসেস করুন" চাপুন।</div>';
    return;
  }

  container.innerHTML = posts.map(p => {
    let icon = 'fa-brands fa-youtube text-red';
    if (p.platform === 'facebook') icon = 'fa-brands fa-facebook text-blue';
    if (p.platform === 'instagram') icon = 'fa-brands fa-instagram text-pink';
    if (p.platform === 'tiktok') icon = 'fa-brands fa-tiktok text-cyan';

    const time = new Date(p.publishedAt).toLocaleTimeString('bn-BD', { hour12: false });
    const isSimulated = p.status === 'simulated' || p.verified === false;
    const badge = isSimulated 
      ? `<span style="font-size: 10px; background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3); padding: 2px 6px; border-radius: 4px; font-weight: 600;" title="${p.auditNote || 'Simulated record'}"><i class="fa-solid fa-triangle-exclamation"></i> সিমুলেটেড / অপ্রমাণিত</span>`
      : `<span style="font-size: 10px; background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3); padding: 2px 6px; border-radius: 4px; font-weight: 600;"><i class="fa-solid fa-circle-check"></i> ভেরিফাইড লাইভ</span>`;

    return `
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: rgba(255,255,255,0.03); border-radius: 6px; margin-bottom: 6px; font-size: 12.5px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <i class="${icon}"></i>
          <span style="font-weight: 600;">${p.platform.toUpperCase()}</span>
          ${badge}
          <span style="color: var(--text-dim); font-size: 11px;">[${time}]</span>
        </div>
        <a href="${p.postUrl}" target="_blank" class="${isSimulated ? 'text-dim' : 'text-blue'}" style="font-weight: 700; text-decoration: underline; font-size: 11.5px;">
          <i class="fa-solid fa-arrow-up-right-from-square"></i> ${isSimulated ? 'সিমুলেটেড লিংক' : 'পোস্ট দেখুন'}
        </a>
      </div>
    `;
  }).join('');
}

async function triggerQuickProcess() {
  const btn = document.getElementById('btnQuickTrigger');
  const origText = btn.innerHTML;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> প্রসেস হচ্ছে...`;
  btn.disabled = true;

  try {
    const res = await fetch('/api/queue/trigger-tick', { method: 'POST' });
    const data = await res.json();
    btn.innerHTML = origText;
    btn.disabled = false;

    if (data.success && data.result) {
      if (data.result.status === 'quota_reached') {
        showToast(data.result.message, 'warning');
      } else if (data.result.status === 'awaiting_approval') {
        showToast('AI বিশ্লেষণ সম্পন্ন! রিভিউ স্টুডিওতে ক্যাপশন দেখুন।', 'success');
        // Open studio for this video
        loadVideoIntoStudio(data.result.fileId, data.result.jobId, data.result.analysis);
        switchTab('tab-studio');
      } else if (data.result.status === 'published') {
        showToast('ভিডিও সফলভাবে সোশ্যাল প্ল্যাটফর্মে পোস্ট সম্পন্ন!', 'success');
      }
    }
    loadDashboardStats();
  } catch (err) {
    btn.innerHTML = origText;
    btn.disabled = false;
    showToast(`ত্রুটি: ${err.message}`, 'error');
  }
}

// ==============================================================================
// 3. Google Drive Library
// ==============================================================================

function initDriveLibraryEvents() {
  const btnSync = document.getElementById('btnSyncNow');
  const btnHdrSync = document.getElementById('btnSyncDriveFolder');
  const searchInput = document.getElementById('librarySearchInput');
  const filterBtns = document.querySelectorAll('.filter-pills .pill-btn');
  const btnPrev = document.getElementById('btnLibPrev');
  const btnNext = document.getElementById('btnLibNext');

  if (btnSync) btnSync.addEventListener('click', syncDriveFolder);
  if (btnHdrSync) btnHdrSync.addEventListener('click', syncDriveFolder);

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      DRIVE_SEARCH = e.target.value.trim();
      loadDriveFiles(1);
    });
  }

  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      DRIVE_FILTER = btn.dataset.filter;
      loadDriveFiles(1);
    });
  });

  if (btnPrev) {
    btnPrev.addEventListener('click', () => {
      if (DRIVE_PAGE > 1) loadDriveFiles(DRIVE_PAGE - 1);
    });
  }
  if (btnNext) {
    btnNext.addEventListener('click', () => {
      loadDriveFiles(DRIVE_PAGE + 1);
    });
  }
}

async function syncDriveFolder() {
  const input = document.getElementById('inputDriveFolder');
  const driveUrl = input ? input.value.trim() : '';

  showToast('গুগল ড্রাইভ ফোল্ডার সিঙ্ক হচ্ছে...', 'info');
  try {
    const res = await fetch('/api/drive/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ driveUrl })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`মোট ${data.totalFiles}টি ভিডিও সফলভাবে সিঙ্ক সম্পন্ন!`, 'success');
      document.getElementById('lblActiveFolder').textContent = data.folderTitle;
      document.getElementById('lblActiveFolderTotal').textContent = `${data.totalFiles}টি`;
      loadDriveFiles(1);
      loadDashboardStats();
    } else {
      showToast(`সিঙ্ক ব্যর্থ: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast(`নেটওয়ার্ক এরর: ${err.message}`, 'error');
  }
}

async function loadDriveFiles(page = 1) {
  DRIVE_PAGE = page;
  try {
    const res = await fetch(`/api/drive/files?page=${page}&limit=24&filter=${DRIVE_FILTER}&search=${encodeURIComponent(DRIVE_SEARCH)}`);
    const data = await res.json();
    if (!data.success) return;

    document.getElementById('lblLibPageIndicator').textContent = `পেজ ${data.page} / ${data.totalPages}`;
    document.getElementById('countLibAll').textContent = data.total;

    renderDriveCards(data.files);
  } catch (err) {
    console.warn('[DriveLibrary] Error loading files:', err.message);
  }
}

function renderDriveCards(files = []) {
  const container = document.getElementById('driveVideosGrid');
  if (!container) return;

  if (files.length === 0) {
    container.innerHTML = '<div class="empty-state" style="grid-column: 1/-1;">কোনো ভিডিও পাওয়া যায়নি।</div>';
    return;
  }

  container.innerHTML = files.map(f => {
    const thumbUrl = f.thumbnailUrl || f.directThumbUrl;
    const isExcluded = !!f.excluded;

    return `
      <div class="video-lib-card ${isExcluded ? 'excluded' : ''}">
        <div class="v-card-thumb-wrap">
          <img src="${thumbUrl}" alt="Thumbnail" loading="lazy" onerror="this.src='https://placehold.co/320x180/0f172a/white?text=Video';">
          <span class="v-card-badge">9:16 Shorts</span>
          <span class="v-card-duration">${f.durationStr || '00:30'}</span>
        </div>
        <div class="v-card-body">
          <h4 class="v-card-title" title="${escapeHtml(f.name)}">${escapeHtml(f.title || f.name)}</h4>
          <div class="v-card-meta">
            <span>সাইজ: ${f.sizeMb || '12'} MB</span>
            <span style="margin-left: 8px;">স্ট্যাটাস: <strong class="${f.status === 'done' ? 'text-green' : ''}">${f.status || 'pending'}</strong></span>
          </div>
          <div class="v-card-actions">
            <button class="btn btn-primary btn-sm" onclick="openStudioForFile('${f.fileId}')" title="AI দিয়ে ক্যাপশন তৈরি করুন">
              <i class="fa-solid fa-wand-magic-sparkles"></i> AI ক্যাপশন
            </button>
            <button class="btn ${isExcluded ? 'btn-accent' : 'btn-outline'} btn-sm" onclick="toggleFileExclusion('${f.fileId}', ${!isExcluded})" title="${isExcluded ? 'পুনরায় সক্রিয় করুন' : 'কিউ থেকে বাদ দিন'}">
              <i class="fa-solid ${isExcluded ? 'fa-plus' : 'fa-ban'}"></i> ${isExcluded ? 'Include' : 'Exclude'}
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

async function toggleFileExclusion(fileId, excluded) {
  try {
    const res = await fetch('/api/drive/exclude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileId, excluded })
    });
    const data = await res.json();
    if (data.success) {
      showToast(excluded ? 'ভিডিওটি বাদ দেওয়া হয়েছে' : 'ভিডিওটি কিউতে যুক্ত হয়েছে', 'info');
      loadDriveFiles(DRIVE_PAGE);
    }
  } catch (err) {
    showToast(`ত্রুটি: ${err.message}`, 'error');
  }
}

// ==============================================================================
// 4. AI Caption Studio
// ==============================================================================

function initStudioEvents() {
  const ptabBtns = document.querySelectorAll('.platform-tabs-nav .ptab-btn');
  ptabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      ptabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      ACTIVE_STUDIO_PLATFORM = btn.dataset.platform;

      document.querySelectorAll('.platform-editor-panel').forEach(panel => {
        panel.classList.toggle('active', panel.id === `editor-${ACTIVE_STUDIO_PLATFORM}`);
      });
    });
  });

  // Live Character Counters
  setupCharCounter('inputYtTitle', 'countYtTitle', 100);
  setupCharCounter('inputFbCaption', 'countFbCaption', 2200);
  setupCharCounter('inputIgCaption', 'countIgCaption', 2200);
  setupCharCounter('inputTtCaption', 'countTtCaption', 2200);

  // Buttons
  const btnRegen = document.getElementById('btnRegenerateAiCaption');
  const btnSaveDraft = document.getElementById('btnSaveCaptionsDraft');
  const btnApproveHdr = document.getElementById('btnApproveAndPublishStudio');
  const btnApproveFtr = document.getElementById('btnApproveAndPublishFooter');

  if (btnRegen) btnRegen.addEventListener('click', regenerateAiCaptions);
  if (btnSaveDraft) btnSaveDraft.addEventListener('click', saveStudioDraft);
  if (btnApproveHdr) btnApproveHdr.addEventListener('click', approveAndPublishCurrentStudio);
  if (btnApproveFtr) btnApproveFtr.addEventListener('click', approveAndPublishCurrentStudio);
}

function setupCharCounter(inputId, counterId, max) {
  const input = document.getElementById(inputId);
  const counter = document.getElementById(counterId);
  if (!input || !counter) return;

  input.addEventListener('input', () => {
    const len = input.value.length;
    counter.textContent = `${len} / ${max}`;
    if (len > max) {
      counter.style.color = '#ef4444';
    } else {
      counter.style.color = 'var(--text-dim)';
    }
  });
}

async function openStudioForFile(fileId) {
  showToast('ভিডিও ও AI ক্যাপশন স্টুডিও লোড হচ্ছে...', 'info');
  switchTab('tab-studio');

  try {
    const res = await fetch(`/api/ai/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileId })
    });
    const data = await res.json();
    if (data.success) {
      loadVideoIntoStudio(fileId, null, data.analysis);
      showToast('AI ক্যাপশন সফলভাবে লোড হয়েছে!', 'success');
    }
  } catch (err) {
    showToast(`AI স্টুডিও লোড ব্যর্থ: ${err.message}`, 'error');
  }
}

function loadVideoIntoStudio(fileId, jobId, analysis) {
  CURRENT_STUDIO_VIDEO = fileId;
  CURRENT_STUDIO_JOB_ID = jobId;
  CURRENT_STUDIO_ANALYSIS = analysis;

  // Video preview player
  const player = document.getElementById('studioVideoPlayer');
  const iframeWrap = document.getElementById('studioIframeWrap');
  const iframe = document.getElementById('studioDriveIframe');

  if (player) {
    player.src = `/api/drive/stream?id=${fileId}`;
    player.style.display = 'block';
    player.load();
  }

  // Populate metadata summary
  document.getElementById('studioVideoTitle').textContent = analysis.youtube?.title || `ভিডিও #${fileId}`;
  document.getElementById('studioAiTopic').textContent = analysis.mainTopic || 'AI Reels';
  document.getElementById('studioAiSummary').textContent = analysis.summary || '-';
  document.getElementById('studioAiHook').textContent = `"${analysis.openingHook || ''}"`;
  document.getElementById('studioAiExplanation').textContent = analysis.explanation || '-';

  // Populate YouTube tab
  document.getElementById('inputYtTitle').value = analysis.youtube?.title || '';
  document.getElementById('inputYtDesc').value = analysis.youtube?.description || '';
  document.getElementById('inputYtTags').value = (analysis.youtube?.tags || []).join(', ');

  // Populate Facebook tab
  document.getElementById('inputFbCaption').value = analysis.facebook?.caption || '';
  document.getElementById('inputFbTags').value = (analysis.facebook?.hashtags || []).join(' ');

  // Populate Instagram tab
  document.getElementById('inputIgCaption').value = analysis.instagram?.caption || '';
  document.getElementById('inputIgTags').value = (analysis.instagram?.hashtags || []).join(' ');

  // Populate TikTok tab
  document.getElementById('inputTtCaption').value = analysis.tiktok?.caption || '';
  document.getElementById('inputTtTags').value = (analysis.tiktok?.hashtags || []).join(' ');

  // Trigger char counters
  ['inputYtTitle', 'inputFbCaption', 'inputIgCaption', 'inputTtCaption'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.dispatchEvent(new Event('input'));
  });
}

function collectStudioCaptions() {
  return {
    summary: document.getElementById('studioAiSummary').textContent,
    mainTopic: document.getElementById('studioAiTopic').textContent,
    openingHook: document.getElementById('studioAiHook').textContent.replace(/^"|"$/g, ''),
    youtube: {
      title: document.getElementById('inputYtTitle').value.trim(),
      description: document.getElementById('inputYtDesc').value.trim(),
      tags: document.getElementById('inputYtTags').value.split(',').map(t => t.trim()).filter(Boolean)
    },
    facebook: {
      caption: document.getElementById('inputFbCaption').value.trim(),
      hashtags: document.getElementById('inputFbTags').value.split(' ').map(t => t.trim()).filter(Boolean)
    },
    instagram: {
      caption: document.getElementById('inputIgCaption').value.trim(),
      hashtags: document.getElementById('inputIgTags').value.split(' ').map(t => t.trim()).filter(Boolean)
    },
    tiktok: {
      caption: document.getElementById('inputTtCaption').value.trim(),
      hashtags: document.getElementById('inputTtTags').value.split(' ').map(t => t.trim()).filter(Boolean)
    }
  };
}

async function saveStudioDraft() {
  if (!CURRENT_STUDIO_VIDEO) return;
  const analysis = collectStudioCaptions();

  try {
    const res = await fetch('/api/ai/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileId: CURRENT_STUDIO_VIDEO, analysis })
    });
    const data = await res.json();
    if (data.success) {
      showToast('ক্যাপশন ড্রাফট সফলভাবে সংরক্ষিত হয়েছে!', 'success');
    }
  } catch (err) {
    showToast(`সংরক্ষণ ব্যর্থ: ${err.message}`, 'error');
  }
}

async function regenerateAiCaptions() {
  if (!CURRENT_STUDIO_VIDEO) return;
  const lang = document.getElementById('selectStudioLanguage').value;
  const style = document.getElementById('selectStudioStyle').value;

  showToast('Gemini AI দিয়ে নতুন ক্যাপশন তৈরি হচ্ছে...', 'info');
  try {
    const res = await fetch('/api/ai/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileId: CURRENT_STUDIO_VIDEO,
        forceRegenerate: true,
        language: lang,
        style: style
      })
    });
    const data = await res.json();
    if (data.success) {
      loadVideoIntoStudio(CURRENT_STUDIO_VIDEO, CURRENT_STUDIO_JOB_ID, data.analysis);
      showToast('নতুন AI ক্যাপশন সফলভাবে তৈরি সম্পন্ন!', 'success');
    }
  } catch (err) {
    showToast(`পুনরায় জেনারেট ব্যর্থ: ${err.message}`, 'error');
  }
}

async function approveAndPublishCurrentStudio() {
  if (!CURRENT_STUDIO_VIDEO) {
    showToast('অনুগ্রহ করে প্রথমে একটি ভিডিও নির্বাচন করুন!', 'warning');
    return;
  }

  const customMetadata = collectStudioCaptions();
  showToast('ভিডিও অনুমোদিত হয়েছে! সোশ্যাল পেজগুলোতে পোস্টিং শুরু হচ্ছে...', 'info');

  try {
    let endpoint = '/api/queue/trigger-tick';
    let body = {};

    if (CURRENT_STUDIO_JOB_ID) {
      endpoint = `/api/queue/approve/${CURRENT_STUDIO_JOB_ID}`;
      body = { customMetadata };
    } else {
      // Direct publish
      body = { fileId: CURRENT_STUDIO_VIDEO, customMetadata };
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.success) {
      showToast('🎉 সফলভাবে সোশ্যাল অ্যাকাউন্টগুলোতে প্রকাশ সম্পন্ন হয়েছে!', 'success');
      loadDashboardStats();
      loadQueue();
      switchTab('tab-queue');
    } else {
      showToast(`পোস্টিং ত্রুটি: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast(`ত্রুটি: ${err.message}`, 'error');
  }
}

// ==============================================================================
// 5. Publishing Queue & History
// ==============================================================================

function initQueueEvents() {
  const btnTrigger = document.getElementById('btnQueueTriggerNow');
  if (btnTrigger) {
    btnTrigger.addEventListener('click', triggerQuickProcess);
  }
}

async function loadQueue() {
  try {
    const res = await fetch('/api/queue');
    const data = await res.json();
    if (!data.success) return;

    renderQueueTable(data.jobs);
  } catch (err) {
    console.warn('[Queue] Load error:', err.message);
  }
}

function renderQueueTable(jobs = []) {
  const tbody = document.getElementById('queueTableBody');
  if (!tbody) return;

  if (jobs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="table-empty">কোনো সক্রিয় কিউ রেকর্ড নেই।</td></tr>';
    return;
  }

  tbody.innerHTML = jobs.map(j => {
    let statusBadge = '<span class="badge blue">Pending</span>';
    if (j.status === 'analyzing') statusBadge = '<span class="badge purple"><i class="fa-solid fa-spinner fa-spin"></i> Analyzing</span>';
    if (j.status === 'awaiting_approval') statusBadge = '<span class="badge gold"><i class="fa-solid fa-clock"></i> Review Awaited</span>';
    if (j.status === 'publishing') statusBadge = '<span class="badge blue"><i class="fa-solid fa-cloud-arrow-up"></i> Publishing</span>';
    if (j.status === 'done') statusBadge = '<span class="badge green"><i class="fa-solid fa-check"></i> Published</span>';
    if (j.status === 'failed') statusBadge = '<span class="badge red"><i class="fa-solid fa-triangle-exclamation"></i> Failed</span>';

    // Results / Published links
    let linksHtml = '-';
    if (j.results && Object.keys(j.results).length > 0) {
      linksHtml = Object.entries(j.results).map(([p, r]) => {
        if (r && r.postUrl) {
          return `<a href="${r.postUrl}" target="_blank" class="text-blue" style="display: inline-block; margin-right: 6px; text-decoration: underline; font-weight: 700;">${p.toUpperCase()}</a>`;
        }
        return '';
      }).join('');
    }

    const dateStr = j.completedAt || j.analyzedAt || j.claimedAt || new Date().toISOString();
    const formattedDate = new Date(dateStr).toLocaleString('bn-BD', { hour12: false });

    return `
      <tr>
        <td>
          <strong style="color: #fff; display: block;">${escapeHtml(j.title || j.fileName)}</strong>
          <span style="font-size: 11px; color: var(--text-dim);">ID: ${j.fileId}</span>
        </td>
        <td>${statusBadge}</td>
        <td>${linksHtml}</td>
        <td style="font-size: 11.5px; color: var(--text-muted);">${formattedDate}</td>
        <td>
          <div style="display: flex; gap: 6px;">
            ${j.status === 'awaiting_approval' ? `
              <button class="btn btn-primary btn-sm" onclick="openStudioForFile('${j.fileId}')">
                <i class="fa-solid fa-check"></i> রিভিউ ও পাবলিশ
              </button>
            ` : ''}
            ${j.status === 'failed' ? `
              <button class="btn btn-outline btn-sm" onclick="retryQueueJob('${j.id}')">
                <i class="fa-solid fa-rotate-right"></i> রিট্রাই
              </button>
            ` : ''}
            <button class="btn btn-ghost btn-sm" onclick="deleteQueueJob('${j.id}')" title="মুছে ফেলুন">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

async function retryQueueJob(jobId) {
  showToast('জব রিট্রাই শুরু হয়েছে...', 'info');
  try {
    const res = await fetch(`/api/queue/retry/${jobId}`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast('সফলভাবে রিট্রাই সম্পন্ন হয়েছে!', 'success');
      loadQueue();
      loadDashboardStats();
    }
  } catch (err) {
    showToast(`রিট্রাই ব্যর্থ: ${err.message}`, 'error');
  }
}

async function deleteQueueJob(jobId) {
  try {
    const res = await fetch(`/api/queue/${jobId}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast('জব মুছে ফেলা হয়েছে', 'info');
      loadQueue();
    }
  } catch (err) {
    showToast(`মুছতে ব্যর্থ: ${err.message}`, 'error');
  }
}

// ==============================================================================
// 6. Social Accounts
// ==============================================================================

function initAccountEvents() {
  const btnOpenModal = document.getElementById('btnOpenAddAccountModal');
  const btnCloseModal = document.getElementById('btnCloseAccountModal');
  const btnCancelModal = document.getElementById('btnCancelAccountModal');
  const btnSaveModal = document.getElementById('btnSaveAccountModal');

  if (btnOpenModal) btnOpenModal.addEventListener('click', () => openModal('modalAddAccount'));
  if (btnCloseModal) btnCloseModal.addEventListener('click', () => closeModal('modalAddAccount'));
  if (btnCancelModal) btnCancelModal.addEventListener('click', () => closeModal('modalAddAccount'));
  if (btnSaveModal) btnSaveModal.addEventListener('click', saveNewAccount);

  // Google OAuth triggers
  const btnOAuthHeader = document.getElementById('btnConnectGoogleOAuth');
  const btnOAuthBanner = document.getElementById('btnTriggerGoogleAuthAction');
  const btnTestDrive = document.getElementById('btnTestGoogleDriveBanner');

  if (btnOAuthHeader) btnOAuthHeader.addEventListener('click', () => handleGoogleConnectRequest());
  if (btnOAuthBanner) btnOAuthBanner.addEventListener('click', () => handleGoogleConnectRequest());
  if (btnTestDrive) btnTestDrive.addEventListener('click', testGoogleDriveDirect);

  // Quick Hub Triggers
  const btnQuickYt = document.getElementById('btnQuickConnectYt');
  if (btnQuickYt) btnQuickYt.addEventListener('click', () => handleGoogleConnectRequest());

  const btnOpenFbDirect = document.getElementById('btnOpenFbDiscoverDirect');
  const btnQuickFb = document.getElementById('btnQuickConnectFb');
  if (btnOpenFbDirect) btnOpenFbDirect.addEventListener('click', () => openModal('modalFacebookDiscover'));
  if (btnQuickFb) btnQuickFb.addEventListener('click', () => openModal('modalFacebookDiscover'));

  const btnQuickIg = document.getElementById('btnQuickConnectIg');
  if (btnQuickIg) btnQuickIg.addEventListener('click', () => {
    openModal('modalFacebookDiscover');
  });

  const btnQuickTt = document.getElementById('btnQuickConnectTt');
  if (btnQuickTt) btnQuickTt.addEventListener('click', () => {
    openModal('modalAddAccount');
    const ttBtn = document.querySelector('.platform-selector-tabs .p-select-btn[data-p="tiktok"]');
    if (ttBtn) ttBtn.click();
  });

  // Facebook Auto-Discover events
  const btnCloseFb = document.getElementById('btnCloseFbDiscover');
  const btnCancelFb = document.getElementById('btnCancelFbDiscover');
  const btnTriggerFb = document.getElementById('btnTriggerFbDiscover');

  if (btnCloseFb) btnCloseFb.addEventListener('click', () => closeModal('modalFacebookDiscover'));
  if (btnCancelFb) btnCancelFb.addEventListener('click', () => closeModal('modalFacebookDiscover'));
  if (btnTriggerFb) btnTriggerFb.addEventListener('click', runFacebookAutoDiscovery);

  // Google Setup Modal events
  const btnCloseGg = document.getElementById('btnCloseGoogleSetup');
  const btnCancelGg = document.getElementById('btnCancelGoogleSetup');
  const btnSaveGgOnly = document.getElementById('btnSaveGoogleCredsOnly');
  const btnSaveGgLaunch = document.getElementById('btnSaveAndLaunchGoogleOAuth');
  const btnCopyRedirect = document.getElementById('btnCopyRedirectUri');
  const btnCopyRedirectSettings = document.getElementById('btnCopyRedirectUriSettings');

  if (btnCloseGg) btnCloseGg.addEventListener('click', () => closeModal('modalGoogleSetup'));
  if (btnCancelGg) btnCancelGg.addEventListener('click', () => closeModal('modalGoogleSetup'));
  if (btnSaveGgOnly) btnSaveGgOnly.addEventListener('click', () => saveGoogleCredentials(false));
  if (btnSaveGgLaunch) btnSaveGgLaunch.addEventListener('click', () => saveGoogleCredentials(true));

  if (btnCopyRedirect) {
    btnCopyRedirect.addEventListener('click', () => {
      navigator.clipboard.writeText('http://localhost:3000/api/auth/google/callback');
      showToast('Redirect URI ক্লিপবোর্ডে কপি হয়েছে!', 'success');
    });
  }
  if (btnCopyRedirectSettings) {
    btnCopyRedirectSettings.addEventListener('click', () => {
      navigator.clipboard.writeText('http://localhost:3000/api/auth/google/callback');
      showToast('Redirect URI ক্লিপবোর্ডে কপি হয়েছে!', 'success');
    });
  }

  // Platform choice tabs in modal
  const pBtns = document.querySelectorAll('.platform-selector-tabs .p-select-btn');
  pBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      pBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const p = btn.dataset.p;
      const lblId = document.getElementById('lblAccId');
      const inputId = document.getElementById('inputAccId');
      const helpId = document.getElementById('helpAccId');

      if (p === 'facebook') {
        if (lblId) lblId.textContent = 'Facebook Page ID (numeric):';
        if (inputId) inputId.placeholder = 'যেমন: 1309863422219233';
        if (helpId) helpId.textContent = 'আপনার Facebook পেজের সংখ্যাসূচক Page ID দিন অথবা অটো-ফাইন্ডার ব্যবহার করুন।';
      } else if (p === 'instagram') {
        if (lblId) lblId.textContent = 'Instagram Professional User ID (numeric):';
        if (inputId) inputId.placeholder = 'যেমন: 1784140029381923';
        if (helpId) helpId.textContent = 'Instagram Graph API এর জন্য numeric Instagram Business Account ID প্রয়োজন।';
      } else if (p === 'youtube') {
        if (lblId) lblId.textContent = 'YouTube Channel ID (ঐচ্ছিক):';
        if (inputId) inputId.placeholder = 'যেমন: UC_xxxx... (OAuth দিয়ে স্বয়ংক্রিয় কানেক্ট সুপারিশকৃত)';
        if (helpId) helpId.textContent = '"Google একাউন্ট কানেক্ট" বাটন দিয়ে ১-ক্লিকে চ্যানেল যুক্ত করুন।';
      } else {
        if (lblId) lblId.textContent = 'TikTok Open ID / Account ID (ঐচ্ছিক):';
        if (inputId) inputId.placeholder = 'যেমন: @bangla_aiviral';
        if (helpId) helpId.textContent = 'Content Posting API অনুমোদন সম্পন্ন টোকেন দিন।';
      }
    });
  });
}

async function handleGoogleConnectRequest() {
  try {
    const res = await fetch('/api/auth/status');
    const data = await res.json();
    if (!data.google.configured) {
      openModal('modalGoogleSetup');
      showToast('প্রথমে Google Client ID ও Secret প্রদান করুন।', 'info');
      return;
    }
    triggerGoogleOAuthFlow();
  } catch (e) {
    triggerGoogleOAuthFlow();
  }
}

async function saveGoogleCredentials(launchOAuthAfter = false) {
  const googleClientId = (document.getElementById('inputGoogleClientId')?.value || '').trim();
  const googleClientSecret = (document.getElementById('inputGoogleClientSecret')?.value || '').trim();

  if (!googleClientId) {
    showToast('অনুগ্রহ করে Google Client ID দিন!', 'warning');
    return;
  }

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ googleClientId, googleClientSecret })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Google Credentials সংরক্ষিত হয়েছে!', 'success');
      closeModal('modalGoogleSetup');
      loadAccounts();
      if (launchOAuthAfter) {
        setTimeout(() => triggerGoogleOAuthFlow(), 300);
      }
    } else {
      showToast(data.error || 'সেভ করতে সমস্যা হয়েছে', 'error');
    }
  } catch (err) {
    showToast(`ত্রুটি: ${err.message}`, 'error');
  }
}

async function runFacebookAutoDiscovery() {
  const tokenInput = document.getElementById('inputFbDiscoverToken');
  const token = (tokenInput ? tokenInput.value : '').trim();
  const statusBox = document.getElementById('fbDiscoverStatusBox');
  const listEl = document.getElementById('fbDiscoveredList');

  if (!token) {
    showToast('অনুগ্রহ করে মেটা এক্সেস টোকেন পেস্ট করুন!', 'warning');
    return;
  }

  statusBox.style.display = 'block';
  statusBox.innerHTML = '<div style="color: var(--accent-cyan); font-size: 13px;"><i class="fa-solid fa-spinner fa-spin"></i> মেটা সার্ভারে পেজ খোঁজা হচ্ছে...</div>';
  listEl.style.display = 'none';
  listEl.innerHTML = '';

  try {
    const res = await fetch('/api/accounts/facebook/discover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    const data = await res.json();

    if (!data.success) {
      statusBox.innerHTML = `<div style="background: rgba(239, 68, 68, 0.15); border: 1px solid var(--accent-red); border-radius: 8px; padding: 12px; color: #fca5a5; font-size: 13px;">
        <i class="fa-solid fa-triangle-exclamation"></i> <strong>ত্রুটি:</strong> ${escapeHtml(data.error || 'পেজ লোড করা যায়নি')}
        <div style="font-size: 12px; margin-top: 6px; color: #cbd5e1;">সুপারিশ: Meta Graph Explorer-এ গিয়ে নিশ্চিত করুন 'pages_show_list', 'pages_manage_posts', 'publish_video' পারমিশন যোগ করা আছে।</div>
      </div>`;
      return;
    }

    statusBox.innerHTML = `<div style="background: rgba(16, 185, 129, 0.15); border: 1px solid var(--accent-green); border-radius: 8px; padding: 10px 14px; color: #86efac; font-size: 13px; display: flex; align-items: center; justify-content: space-between;">
      <span><i class="fa-solid fa-circle-check"></i> ${escapeHtml(data.message)} (ব্যবহারকারী: ${escapeHtml(data.userName || 'Meta User')})</span>
    </div>`;

    let html = '';
    
    // Facebook Pages
    (data.pages || []).forEach(p => {
      const avatarHtml = p.picture 
        ? `<img src="${p.picture}" class="discovered-avatar" alt="${escapeHtml(p.name)}">`
        : `<div class="discovered-avatar" style="color: #1877f2;"><i class="fa-brands fa-facebook"></i></div>`;

      html += `
        <div class="discovered-item">
          <div class="discovered-info">
            ${avatarHtml}
            <div>
              <strong style="color: #fff; font-size: 14px; display: block;">${escapeHtml(p.name)}</strong>
              <span style="font-size: 11.5px; color: var(--text-muted);">${escapeHtml(p.category || 'Facebook Page')} &bull; ID: <code>${p.id}</code></span>
            </div>
          </div>
          <button class="btn btn-primary btn-sm" onclick="connectDiscoveredAccount('facebook', '${escapeJs(p.name)}', '${p.id}', '${escapeJs(p.token)}')">
            <i class="fa-solid fa-plus"></i> ১-ক্লিকে কানেক্ট
          </button>
        </div>
      `;
    });

    // Instagram Accounts
    (data.instagramAccounts || []).forEach(ig => {
      const avatarHtml = ig.picture 
        ? `<img src="${ig.picture}" class="discovered-avatar" alt="${escapeHtml(ig.username)}">`
        : `<div class="discovered-avatar" style="color: #ec4899;"><i class="fa-brands fa-instagram"></i></div>`;

      html += `
        <div class="discovered-item">
          <div class="discovered-info">
            ${avatarHtml}
            <div>
              <strong style="color: #fff; font-size: 14px; display: block;">@${escapeHtml(ig.username)}</strong>
              <span style="font-size: 11.5px; color: var(--text-muted);">Instagram Business &bull; Linked with: ${escapeHtml(ig.linkedPageName || 'Page')}</span>
            </div>
          </div>
          <button class="btn btn-primary btn-sm" style="background: linear-gradient(45deg, #f09433, #dc2743);" onclick="connectDiscoveredAccount('instagram', '${escapeJs(ig.name || ig.username)}', '${ig.id}', '${escapeJs(ig.token)}', '${escapeJs(ig.username)}')">
            <i class="fa-brands fa-instagram"></i> Instagram কানেক্ট
          </button>
        </div>
      `;
    });

    listEl.innerHTML = html;
    listEl.style.display = 'flex';

  } catch (err) {
    statusBox.innerHTML = `<div style="color: var(--accent-red); font-size: 13px;">সার্ভার এরর: ${escapeHtml(err.message)}</div>`;
  }
}

async function connectDiscoveredAccount(platform, name, idOrPageId, token, handle = '') {
  showToast(`"${name}" একাউন্টটি লাইভ কানেক্ট করা হচ্ছে...`, 'info');
  try {
    const payload = {
      platform,
      name,
      handle: handle ? (handle.startsWith('@') ? handle : `@${handle}`) : `@${name.toLowerCase().replace(/\s+/g, '')}`,
      pageId: platform === 'facebook' ? idOrPageId : null,
      igUserId: platform === 'instagram' ? idOrPageId : null,
      token
    };

    const res = await fetch('/api/accounts/quick-connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (data.success) {
      showToast(`✅ "${name}" (${platform.toUpperCase()}) সফলভাবে কানেক্ট ও লাইভ ভেরিফাইড হয়েছে!`, 'success');
      closeModal('modalFacebookDiscover');
      loadAccounts();
    } else {
      showToast(data.error || 'কানেক্ট করতে সমস্যা হয়েছে', 'error');
    }
  } catch (err) {
    showToast(`কানেক্ট ত্রুটি: ${err.message}`, 'error');
  }
}

function escapeJs(str) {
  if (!str) return '';
  return String(str).replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

async function triggerGoogleOAuthFlow() {
  try {
    const res = await fetch('/api/auth/google/url');
    const data = await res.json();
    if (data.url) {
      window.open(data.url, 'google_oauth_popup', 'width=600,height=700');
    } else {
      showToast(data.error || 'Google OAuth URL তৈরি করা যায়নি।', 'error');
      openModal('modalGoogleSetup');
    }
  } catch (err) {
    showToast(`OAuth ত্রুটি: ${err.message}`, 'error');
  }
}

async function testGoogleDriveDirect() {
  showToast('Google Drive API v3 কানেকশন যাচাই হচ্ছে...', 'info');
  try {
    const res = await fetch('/api/auth/test-drive');
    const data = await res.json();
    if (data.success && data.result) {
      if (data.result.authenticated) {
        showToast(data.result.message, 'success');
      } else {
        showToast(data.result.message, 'warning');
      }
      loadAccounts();
      loadDashboardStats();
    }
  } catch (err) {
    showToast(`Drive টেস্ট ব্যর্থ: ${err.message}`, 'error');
  }
}

async function loadAccounts() {
  try {
    // 1. Fetch Social Accounts
    const res = await fetch('/api/accounts');
    const data = await res.json();
    if (data.success) {
      renderAccountsGrid(data.accounts);
      const activeCount = data.accounts.filter(a => a.connected).length;
      const countEl = document.getElementById('navAccountsCount');
      if (countEl) countEl.textContent = activeCount;

      // Update Quick Hub Badges
      const ytAcc = data.accounts.find(a => a.platform === 'youtube' && a.connected);
      const fbAcc = data.accounts.find(a => a.platform === 'facebook' && a.connected);
      const igAcc = data.accounts.find(a => a.platform === 'instagram' && a.connected);
      const ttAcc = data.accounts.find(a => a.platform === 'tiktok' && a.connected);

      const qbYt = document.getElementById('quickBadgeYt');
      const qdYt = document.getElementById('quickDescYt');
      if (qbYt) {
        qbYt.className = ytAcc ? 'badge green' : 'badge red';
        qbYt.innerHTML = ytAcc ? '<i class="fa-solid fa-circle-check"></i> কানেক্টেড' : 'অসংযুক্ত';
      }
      if (qdYt && ytAcc) qdYt.textContent = `চ্যানেল: ${ytAcc.name} (${ytAcc.handle || ytAcc.channelId})`;

      const qbFb = document.getElementById('quickBadgeFb');
      const qdFb = document.getElementById('quickDescFb');
      if (qbFb) {
        qbFb.className = fbAcc ? 'badge green' : 'badge blue';
        qbFb.innerHTML = fbAcc ? '<i class="fa-solid fa-circle-check"></i> কানেক্টেড' : 'অসংযুক্ত';
      }
      if (qdFb && fbAcc) qdFb.textContent = `সংযুক্ত পেজ: ${fbAcc.name} (${fbAcc.handle || fbAcc.pageId})`;

      const qbIg = document.getElementById('quickBadgeIg');
      const qdIg = document.getElementById('quickDescIg');
      if (qbIg) {
        qbIg.className = igAcc ? 'badge green' : 'badge pink';
        qbIg.innerHTML = igAcc ? '<i class="fa-solid fa-circle-check"></i> কানেক্টেড' : 'অসংযুক্ত';
      }
      if (qdIg && igAcc) qdIg.textContent = `ইনস্টাগ্রাম: ${igAcc.name} (${igAcc.handle || igAcc.igUserId})`;

      const qbTt = document.getElementById('quickBadgeTt');
      const qdTt = document.getElementById('quickDescTt');
      if (qbTt) {
        qbTt.className = ttAcc ? 'badge green' : 'badge cyan';
        qbTt.innerHTML = ttAcc ? '<i class="fa-solid fa-circle-check"></i> কানেক্টেড' : 'অসংযুক্ত';
      }
      if (qdTt && ttAcc) qdTt.textContent = `টিকটক: ${ttAcc.name} (${ttAcc.handle})`;
    }

    // 2. Fetch Google OAuth Status
    const authRes = await fetch('/api/auth/status');
    const authData = await authRes.json();
    if (authData.google) {
      const badge = document.getElementById('badgeGoogleOAuth');
      const desc = document.getElementById('descGoogleOAuth');
      const btnLbl = document.getElementById('lblGoogleAuthBtn');

      if (authData.google.connected) {
        if (badge) {
          badge.className = 'badge green';
          badge.innerHTML = `<i class="fa-solid fa-circle-check"></i> Connected (${authData.google.email || 'OAuth Active'})`;
        }
        if (desc) {
          desc.textContent = `অনুমোদিত ইমেইল: ${authData.google.email || 'Google Account'} | ফোল্ডার: ${authData.google.selectedFolderName || 'Google Drive'} | স্কোপ: Drive & YouTube`;
        }
        if (btnLbl) btnLbl.textContent = 'Reconnect Google';

        const gNotice = document.getElementById('boxGoogleConnectedNotice');
        if (gNotice) {
          gNotice.style.display = 'block';
          const emailEl = document.getElementById('lblGoogleConnectedEmail');
          if (emailEl) emailEl.textContent = `Connected: ${authData.google.email}`;
        }
      } else if (authData.google.configured) {
        if (badge) {
          badge.className = 'badge gold';
          badge.innerHTML = '<i class="fa-solid fa-clock"></i> Credentials Set (Awaiting Login)';
        }
        if (desc) {
          desc.textContent = 'Google Cloud Credentials কনফিগার করা আছে। লাইভ Drive API ও YouTube সক্রিয় করতে "Connect Google" বাটনে চাপুন।';
        }
        if (btnLbl) btnLbl.textContent = 'Connect Google';
      } else {
        if (badge) {
          badge.className = 'badge red';
          badge.innerHTML = '<i class="fa-solid fa-key"></i> Missing Credentials';
        }
        if (desc) {
          desc.textContent = 'Settings বা Social Accounts থেকে Google Client ID ও Secret কনফিগার করুন।';
        }
        if (btnLbl) btnLbl.textContent = 'Configure Google';
      }
    }
  } catch (err) {
    console.warn('[Accounts] Load error:', err.message);
  }
}

function renderAccountsGrid(accounts = []) {
  const container = document.getElementById('accountsGridContainer');
  if (!container) return;

  container.innerHTML = accounts.map(a => {
    let icon = 'fa-brands fa-youtube';
    let avatarClass = 'acc-youtube';
    if (a.platform === 'facebook') { icon = 'fa-brands fa-facebook'; avatarClass = 'acc-facebook'; }
    if (a.platform === 'instagram') { icon = 'fa-brands fa-instagram'; avatarClass = 'acc-instagram'; }
    if (a.platform === 'tiktok') { icon = 'fa-brands fa-tiktok'; avatarClass = 'acc-tiktok'; }

    let statusPill = '';
    if (a.verified) {
      statusPill = '<span class="badge green" title="Provider API response verified"><i class="fa-solid fa-circle-check"></i> Verified Live</span>';
    } else if (a.hasToken) {
      statusPill = '<span class="badge gold" title="Token configured, click check to verify"><i class="fa-solid fa-key"></i> Token Configured</span>';
    } else {
      statusPill = '<span class="badge red" title="No token or credentials configured"><i class="fa-solid fa-triangle-exclamation"></i> No Token</span>';
    }

    let detailStr = 'OAuth / API Token Required';
    if (a.platform === 'youtube') {
      detailStr = a.channelId ? `Channel ID: ${a.channelId}` : (a.hasToken ? 'OAuth Token Present' : 'Google OAuth Required');
    } else if (a.platform === 'facebook') {
      detailStr = a.pageId ? `Page ID: ${a.pageId}` : (a.hasToken ? 'Page Token Present' : 'Page Access Token Required');
    } else if (a.platform === 'instagram') {
      detailStr = a.igUserId ? `IG User ID: ${a.igUserId}` : (a.hasToken ? 'Token Present' : 'Numeric IG User ID Required');
    } else if (a.platform === 'tiktok') {
      detailStr = a.hasToken ? 'Content Posting Token Present' : 'Audit Approved Token Required';
    }

    return `
      <div class="account-card">
        <div class="account-card-header">
          <div class="acc-avatar ${avatarClass}"><i class="${icon}"></i></div>
          <div style="flex: 1; min-width: 0;">
            <strong style="color: #fff; font-size: 14px; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(a.name)}</strong>
            <span style="font-size: 11.5px; color: var(--text-muted);">${escapeHtml(a.handle)}</span>
          </div>
          ${statusPill}
        </div>

        <div style="font-size: 11.5px; color: var(--text-muted); margin-bottom: 16px;">
          <span>API Credentials: <strong style="color: ${a.hasToken ? '#34d399' : '#f87171'};">${detailStr}</strong></span>
        </div>

        <div style="display: flex; gap: 8px; margin-top: auto; flex-wrap: wrap;">
          <button class="btn btn-outline btn-sm" style="flex: 1;" onclick="testAccountConnection('${a.id}')">
            <i class="fa-solid fa-satellite-dish"></i> কানেকশন চেক
          </button>
          ${a.platform === 'youtube' && !a.hasToken ? `
            <button class="btn btn-primary btn-sm" onclick="triggerGoogleOAuthFlow()" title="Google OAuth দিয়ে চ্যানেল কানেক্ট করুন">
              <i class="fa-brands fa-google"></i> OAuth
            </button>
          ` : ''}
          <button class="btn btn-ghost btn-sm" onclick="deleteAccount('${a.id}')" title="মুছে ফেলুন">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

async function saveNewAccount() {
  const activePBtn = document.querySelector('.platform-selector-tabs .p-select-btn.active');
  const platform = activePBtn ? activePBtn.dataset.p : 'youtube';

  const name = document.getElementById('inputAccName').value.trim();
  const handle = document.getElementById('inputAccHandle').value.trim();
  const accId = document.getElementById('inputAccId') ? document.getElementById('inputAccId').value.trim() : '';
  const token = document.getElementById('inputAccToken').value.trim();

  if (!name) {
    showToast('অনুগ্রহ করে নাম লিখুন!', 'warning');
    return;
  }

  const payload = {
    platform,
    name,
    handle,
    token
  };

  if (platform === 'facebook' && accId) payload.pageId = accId;
  if (platform === 'instagram' && accId) payload.igUserId = accId;
  if (platform === 'youtube' && accId) payload.channelId = accId;

  try {
    const res = await fetch('/api/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      showToast(`${platform.toUpperCase()} অ্যাকাউন্ট সংরক্ষিত হয়েছে!`, 'success');
      closeModal('modalAddAccount');
      loadAccounts();
      document.getElementById('inputAccName').value = '';
      document.getElementById('inputAccHandle').value = '';
      if (document.getElementById('inputAccId')) document.getElementById('inputAccId').value = '';
      document.getElementById('inputAccToken').value = '';
    }
  } catch (err) {
    showToast(`যুক্ত করতে ব্যর্থ: ${err.message}`, 'error');
  }
}

async function testAccountConnection(id) {
  showToast('লাইভ API যাচাইকরণ চলছে...', 'info');
  try {
    const res = await fetch(`/api/accounts/test/${id}`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      if (data.connected && data.status === 'VERIFIED') {
        showToast(data.message, 'success');
      } else {
        showToast(data.message, 'warning');
      }
      loadAccounts();
    }
  } catch (err) {
    showToast(`টেস্ট ব্যর্থ: ${err.message}`, 'error');
  }
}

async function deleteAccount(id) {
  if (!confirm('আপনি কি নিশ্চিতভাবে এই অ্যাকাউন্টটি মুছে ফেলতে চান?')) return;
  try {
    const res = await fetch(`/api/accounts/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast('অ্যাকাউন্ট মুছে ফেলা হয়েছে', 'info');
      loadAccounts();
    }
  } catch (err) {
    showToast(`মুছতে ব্যর্থ: ${err.message}`, 'error');
  }
}

// ==============================================================================
// 7. Settings & Cost Control
// ==============================================================================

function initSettingsEvents() {
  const btnSave = document.getElementById('btnSaveAllSettings');
  if (btnSave) {
    btnSave.addEventListener('click', saveAllSettings);
  }

  const btnTestGemini = document.getElementById('btnTestGeminiLive');
  if (btnTestGemini) {
    btnTestGemini.addEventListener('click', async () => {
      showToast('Gemini API লাইভ টেস্ট চলছে...', 'info');
      try {
        const res = await fetch('/api/ai/test');
        const data = await res.json();
        if (data.result && data.result.connected) {
          showToast(data.result.message, 'success');
        } else {
          showToast(data.result?.message || data.error || 'Gemini কানেকশন টেস্ট ব্যর্থ', 'warning');
        }
      } catch (e) {
        showToast(`Gemini টেস্ট এরর: ${e.message}`, 'error');
      }
    });
  }

  const btnTestDriveSettings = document.getElementById('btnTestDriveLive');
  if (btnTestDriveSettings) {
    btnTestDriveSettings.addEventListener('click', testGoogleDriveDirect);
  }
}

async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    const data = await res.json();
    if (!data.success) return;

    const { settings, costStats } = data;

    document.getElementById('cfgDailyLimit').value = settings.dailyLimit || 3;
    document.getElementById('cfgTimezone').value = settings.timezone || 'Asia/Dhaka';
    document.getElementById('cfgGeminiModel').value = settings.geminiModel || 'gemini-2.5-flash';
    document.getElementById('cfgDailyAiLimit').value = settings.dailyGeminiLimit || 50;

    // Credentials inputs
    const inputGgClientId = document.getElementById('cfgGoogleClientId');
    const inputGgClientSecret = document.getElementById('cfgGoogleClientSecret');
    const inputGeminiKey = document.getElementById('cfgGeminiApiKey');

    if (inputGgClientId && settings.googleClientId) inputGgClientId.value = settings.googleClientId;
    if (inputGgClientSecret && settings.hasGoogleClientSecret) inputGgClientSecret.placeholder = '•••••••••••••••• (সংরক্ষিত আছে)';
    if (inputGeminiKey && settings.geminiApiKey) inputGeminiKey.value = settings.geminiApiKey;

    // Radio mode
    const modeRadios = document.querySelectorAll('input[name="cfgMode"]');
    modeRadios.forEach(r => {
      r.checked = settings.reviewMode ? r.value === 'review' : r.value === 'auto';
    });

    // Cost Breakdown stats
    if (costStats) {
      document.getElementById('costStatTodayReq').textContent = `${costStats.todayRequests} / ${costStats.dailyLimit}`;
      document.getElementById('costStatTodayUsd').textContent = `$${costStats.todayEstimatedCost}`;
    }
  } catch (err) {
    console.warn('[Settings] Load error:', err.message);
  }
}

async function saveAllSettings() {
  const dailyLimit = parseInt(document.getElementById('cfgDailyLimit').value, 10) || 3;
  const timezone = document.getElementById('cfgTimezone').value;
  const geminiModel = document.getElementById('cfgGeminiModel').value;
  const dailyGeminiLimit = parseInt(document.getElementById('cfgDailyAiLimit').value, 10) || 50;

  const modeRadio = document.querySelector('input[name="cfgMode"]:checked');
  const reviewMode = modeRadio ? modeRadio.value === 'review' : true;
  const autoPublishEnabled = !reviewMode;

  const googleClientId = (document.getElementById('cfgGoogleClientId')?.value || '').trim();
  const googleClientSecret = (document.getElementById('cfgGoogleClientSecret')?.value || '').trim();
  const geminiApiKey = (document.getElementById('cfgGeminiApiKey')?.value || '').trim();

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dailyLimit,
        timezone,
        geminiModel,
        dailyGeminiLimit,
        reviewMode,
        autoPublishEnabled,
        googleClientId,
        googleClientSecret,
        geminiApiKey
      })
    });
    const data = await res.json();
    if (data.success) {
      showToast('সেটিংস ও API ক্রেডেনশিয়ালস সফলভাবে সংরক্ষিত হয়েছে!', 'success');
      loadDashboardStats();
      loadAccounts();
    }
  } catch (err) {
    showToast(`সেটিংস সেভ ব্যর্থ: ${err.message}`, 'error');
  }
}

// ==============================================================================
// 8. Utilities & Modals
// ==============================================================================

function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.style.display = 'flex';
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.style.display = 'none';
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastStack');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  let icon = 'fa-circle-info';
  if (type === 'success') icon = 'fa-circle-check';
  if (type === 'warning') icon = 'fa-triangle-exclamation';
  if (type === 'error') icon = 'fa-circle-xmark';

  toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    if (toast.parentNode) toast.parentNode.removeChild(toast);
  }, 4000);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
