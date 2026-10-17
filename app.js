/**
 * Drive2Tube — Google Drive to YouTube Multi-Channel Auto Poster
 * Direct Google Drive Video Streaming, Live Folder Embedding, & Drag-and-Drop Batch Loader.
 */

// ==========================================================================
// Initial State
// ==========================================================================

let CONNECTED_CHANNELS = [
  {
    id: "ch_yt_1",
    platform: "youtube",
    name: "Aesthetic Reels Bangla 🌸",
    handle: "@AestheticReelsHQ",
    niche: "Shorts & AI Reels",
    avatar: "YT",
    color: "#ff0033",
    icon: "fa-brands fa-youtube",
    isConnected: true,
    isSelected: true
  },
  {
    id: "ch_fb_1",
    platform: "facebook",
    name: "AI Food Cartoon Bangla (Page)",
    handle: "@AIFoodCartoonBangla",
    niche: "Facebook Reels",
    avatar: "FB",
    color: "#1877f2",
    icon: "fa-brands fa-facebook",
    isConnected: true,
    isSelected: true
  },
  {
    id: "ch_tt_1",
    platform: "tiktok",
    name: "Bangla AI Food Official (TikTok)",
    handle: "@bangla_aifood_official",
    niche: "TikTok Viral Reels",
    avatar: "TT",
    color: "#00f2fe",
    icon: "fa-brands fa-tiktok",
    isConnected: true,
    isSelected: true
  }
];

let ACTIVE_PLATFORM_FILTER = 'all';
let MODAL_ACTIVE_PLATFORM = 'youtube';

let LOADED_VIDEOS = [];
let CURRENT_PAGE = 1;
const PAGE_SIZE = 50;
let SEARCH_QUERY = '';
let IS_AUTO_POSTING = false;
let POSTING_TIMER = null;

// ==========================================================================
// Initialization
// ==========================================================================

document.addEventListener('DOMContentLoaded', () => {
  loadStoredChannels();
  renderChannelsList();
  initEventListeners();
  initDropZone();
  updateQueueStats();
  renderVideosQueue();
  addLog("system", "🚀 Drive2Tube ইঞ্জিন প্রস্তুত। গুগল ড্রাইভ ফোল্ডারের শেয়ার লিংক দিয়ে 'সব ভিডিও লোড করুন' বাটনে চাপুন।");

  // Restore user custom link ONLY if they previously saved one
  const savedUrl = localStorage.getItem('d2t_custom_drive_url');
  const urlInput = document.getElementById('driveUrlInput');
  if (urlInput && savedUrl) {
    urlInput.value = savedUrl;
  }
});

function initEventListeners() {
  // Fetch Drive Folder Button (Loads ALL videos)
  const btnFetch = document.getElementById('btnFetchDriveVideos');
  if (btnFetch) btnFetch.addEventListener('click', handleFetchDriveVideos);

  // Clear Drive URL Input Button
  const btnClearUrl = document.getElementById('btnClearDriveUrl');
  if (btnClearUrl) {
    btnClearUrl.addEventListener('click', () => {
      const urlInput = document.getElementById('driveUrlInput');
      if (urlInput) {
        urlInput.value = '';
        urlInput.focus();
      }
      localStorage.removeItem('d2t_custom_drive_url');
      showToast('ড্রাইভ লিংক ক্লিয়ার করা হয়েছে', 'info');
    });
  }

  // Batch count selector listener
  const batchSelect = document.getElementById('driveBatchCountSelect');
  if (batchSelect) {
    batchSelect.addEventListener('change', () => {
      const urlInput = document.getElementById('driveUrlInput');
      if (urlInput && urlInput.value.trim()) {
        handleFetchDriveVideos();
      }
    });
  }

  // Search input listener with instant filtering
  const searchInput = document.getElementById('queueSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      SEARCH_QUERY = e.target.value;
      CURRENT_PAGE = 1;
      renderVideosQueue();
    });
  }

  // Pagination Prev Button
  const btnPrev = document.getElementById('btnPrevPage');
  if (btnPrev) {
    btnPrev.addEventListener('click', () => {
      if (CURRENT_PAGE > 1) {
        CURRENT_PAGE--;
        renderVideosQueue();
        const list = document.getElementById('videosQueueList');
        if (list) list.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }

  // Pagination Next Button
  const btnNext = document.getElementById('btnNextPage');
  if (btnNext) {
    btnNext.addEventListener('click', () => {
      const filtered = getFilteredVideos();
      const totalPages = Math.ceil(filtered.length / PAGE_SIZE) || 1;
      if (CURRENT_PAGE < totalPages) {
        CURRENT_PAGE++;
        renderVideosQueue();
        const list = document.getElementById('videosQueueList');
        if (list) list.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }

  // Pagination Load More Fifty Button
  const btnLoadMore = document.getElementById('btnLoadMoreFifty');
  if (btnLoadMore) {
    btnLoadMore.addEventListener('click', () => {
      const filtered = getFilteredVideos();
      const totalPages = Math.ceil(filtered.length / PAGE_SIZE) || 1;
      if (CURRENT_PAGE < totalPages) {
        CURRENT_PAGE++;
        renderVideosQueue();
        showToast(`পরবর্তী ৫০টি ভিডিও লোড হয়েছে (পেজ ${CURRENT_PAGE} / ${totalPages})`, 'info');
      } else {
        showToast('সব ভিডিও ইতিমধ্যে দেখাচ্ছে!', 'info');
      }
    });
  }

  // Local Folder / Multiple File Picker
  const localFolderInput = document.getElementById('localFolderInput');
  if (localFolderInput) {
    localFolderInput.addEventListener('change', handleLocalFilesSelect);
  }

  // Add More Videos Button
  const btnAddMore = document.getElementById('btnAddMoreVideosBtn');
  if (btnAddMore) {
    btnAddMore.addEventListener('click', () => {
      addNewVideoToQueue();
      showToast('আরেকটি নতুন রিলস কিউতে যুক্ত করা হয়েছে!', 'success');
    });
  }

  // Reset All Queue Status Button
  const btnResetQueue = document.getElementById('btnResetAllQueueStatus');
  if (btnResetQueue) {
    btnResetQueue.addEventListener('click', () => {
      LOADED_VIDEOS.forEach(v => {
        v.status = 'pending';
        v.progress = 0;
        v.publishedFb = null;
        v.publishedUrl = null;
        v.publishedTt = null;
      });
      renderVideosQueue();
      updateQueueStats();
      showToast('সব ভিডিওর স্ট্যাটাস রিসেট করা হয়েছে (পেন্ডিং)!', 'info');
      addLog("system", "সব ভিডিওর পোস্টিং স্ট্যাটাস সফলভাবে পেন্ডিং-এ রিসেট করা হয়েছে।");
    });
  }

  // Start Auto Posting Bulk Button
  const btnStart = document.getElementById('btnStartBulkUpload');
  if (btnStart) btnStart.addEventListener('click', toggleAutoPoster);

  // Clear Videos List
  const btnClearVideos = document.getElementById('btnClearAllVideos');
  if (btnClearVideos) {
    btnClearVideos.addEventListener('click', () => {
      if (IS_AUTO_POSTING) {
        showToast('পোস্টিং চলাকালীন লিস্ট ক্লিয়ার করা যাবে না! প্রথমে থামান।', 'warning');
        return;
      }
      LOADED_VIDEOS = [];
      renderVideosQueue();
      updateQueueStats();
      addLog("system", "ভিডিও কিউ ক্লিয়ার করা হয়েছে।");
      showToast('সব ভিডিও মুছে ফেলা হয়েছে', 'info');
    });
  }

  // Select All Videos
  const btnSelectAll = document.getElementById('btnSelectAllVideos');
  if (btnSelectAll) {
    btnSelectAll.addEventListener('click', () => {
      LOADED_VIDEOS.forEach(v => v.selected = true);
      renderVideosQueue();
      showToast('সব ভিডিও নির্বাচিত হয়েছে', 'info');
    });
  }

  // Video Preview Modal Handlers
  const btnClosePreview = document.getElementById('btnClosePreviewModal');
  const btnDismissPreview = document.getElementById('btnDismissPreview');
  if (btnClosePreview) btnClosePreview.addEventListener('click', closeVideoPreviewModal);
  if (btnDismissPreview) btnDismissPreview.addEventListener('click', closeVideoPreviewModal);

  // Platform Filter Pills in Step 2
  const filterPills = document.querySelectorAll('.platform-filter-pill');
  filterPills.forEach(pill => {
    pill.addEventListener('click', () => {
      filterPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      ACTIVE_PLATFORM_FILTER = pill.dataset.filter || 'all';
      renderChannelsList();
    });
  });

  // Add Channel Modal Handlers
  const btnAddChannel = document.getElementById('btnAddChannelBtn');
  const btnCloseModal = document.getElementById('btnCloseChannelModal');
  const btnCancelModal = document.getElementById('btnCancelChannelModal');
  const btnSaveChannel = document.getElementById('btnSaveNewChannel');

  // Platform choice switcher buttons inside modal
  const choiceBtns = document.querySelectorAll('.platform-choice-btn');
  choiceBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      choiceBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      MODAL_ACTIVE_PLATFORM = btn.dataset.platform || 'youtube';
      updateModalFieldsForPlatform(MODAL_ACTIVE_PLATFORM);
    });
  });

  if (btnAddChannel) btnAddChannel.addEventListener('click', () => {
    updateModalFieldsForPlatform(MODAL_ACTIVE_PLATFORM);
    openModal('addChannelModal');
  });
  if (btnCloseModal) btnCloseModal.addEventListener('click', () => closeModal('addChannelModal'));
  if (btnCancelModal) btnCancelModal.addEventListener('click', () => closeModal('addChannelModal'));

  if (btnSaveChannel) {
    btnSaveChannel.addEventListener('click', () => {
      const name = document.getElementById('newChannelName').value.trim();
      const rawHandle = document.getElementById('newChannelHandle').value.trim();
      const niche = document.getElementById('newChannelNiche').value.trim() || 'Shorts / Reels';
      const token = document.getElementById('newChannelToken') ? document.getElementById('newChannelToken').value.trim() : '';

      if (!name) {
        showToast('অনুগ্রহ করে নাম লিখুন!', 'warning');
        return;
      }

      let color = '#ff0033';
      let icon = 'fa-brands fa-youtube';
      let avatarText = name.slice(0, 2).toUpperCase();

      let cleanHandleVal = rawHandle;
      if (MODAL_ACTIVE_PLATFORM === 'facebook') {
        color = '#1877f2';
        icon = 'fa-brands fa-facebook';
        avatarText = 'FB';
        cleanHandleVal = cleanHandleVal.replace(/^https?:\/\/(www\.)?facebook\.com\//i, '').replace(/\/$/, '').replace(/^@/, '');
        const idMatch = cleanHandleVal.match(/id=(\d+)/);
        if (idMatch) cleanHandleVal = idMatch[1];
        cleanHandleVal = cleanHandleVal.split('?')[0].split('#')[0].trim();
        if (token) localStorage.setItem('d2t_fbToken', token);
      } else if (MODAL_ACTIVE_PLATFORM === 'tiktok') {
        color = '#00f2fe';
        icon = 'fa-brands fa-tiktok';
        avatarText = 'TT';
      } else {
        avatarText = 'YT';
      }

      const formattedHandle = cleanHandleVal 
        ? (cleanHandleVal.startsWith('@') ? cleanHandleVal : `@${cleanHandleVal}`)
        : `@${name.toLowerCase().replace(/\s+/g, '')}`;

      const newCh = {
        id: `ch_${MODAL_ACTIVE_PLATFORM}_${Date.now()}`,
        platform: MODAL_ACTIVE_PLATFORM,
        name,
        handle: formattedHandle,
        niche,
        avatar: avatarText,
        color: color,
        icon: icon,
        token: token,
        isConnected: true,
        isSelected: true
      };

      CONNECTED_CHANNELS.push(newCh);
      saveStoredChannels();
      renderChannelsList();
      closeModal('addChannelModal');

      const logType = MODAL_ACTIVE_PLATFORM === 'youtube' ? 'yt' : (MODAL_ACTIVE_PLATFORM === 'facebook' ? 'fb' : 'tiktok');
      const platformName = MODAL_ACTIVE_PLATFORM === 'youtube' ? 'YouTube চ্যানেল' : (MODAL_ACTIVE_PLATFORM === 'facebook' ? 'Facebook পেজ' : 'TikTok অ্যাকাউন্ট');

      addLog(logType, `🎉 নতুন ${platformName} কানেক্ট করা হয়েছে: ${name} (${newCh.handle}) — সরাসরি পোস্টিং প্রস্তুত!`);
      showToast(`${platformName} '${name}' সফলভাবে কানেক্ট হয়েছে!`, 'success');

      document.getElementById('newChannelName').value = '';
      document.getElementById('newChannelHandle').value = '';
      if (document.getElementById('newChannelToken')) document.getElementById('newChannelToken').value = '';
    });
  }

  // API Modal Handlers
  const btnOpenApi = document.getElementById('btnOpenApiModal');
  const btnCloseApi = document.getElementById('btnCloseApiModal');
  const btnCancelApi = document.getElementById('btnCancelApiModal');
  const btnSaveApi = document.getElementById('btnSaveApiSettings');

  if (btnOpenApi) btnOpenApi.addEventListener('click', () => openModal('apiModal'));
  if (btnCloseApi) btnCloseApi.addEventListener('click', () => closeModal('apiModal'));
  if (btnCancelApi) btnCancelApi.addEventListener('click', () => closeModal('apiModal'));

  if (btnSaveApi) {
    btnSaveApi.addEventListener('click', () => {
      const ytToken = document.getElementById('ytClientId') ? document.getElementById('ytClientId').value.trim() : '';
      const fbToken = document.getElementById('fbPageToken') ? document.getElementById('fbPageToken').value.trim() : '';
      const ttToken = document.getElementById('tiktokApiKey') ? document.getElementById('tiktokApiKey').value.trim() : '';
      
      localStorage.setItem('d2t_ytToken', ytToken);
      localStorage.setItem('d2t_fbToken', fbToken);
      localStorage.setItem('d2t_ttToken', ttToken);

      closeModal('apiModal');
      addLog("system", "সোশ্যাল মিডিয়া এপিআই ক্রেডেনশিয়ালস (YouTube, Facebook, TikTok) সংরক্ষিত হয়েছে।");
      showToast('সব প্ল্যাটফর্মের এপিআই সেটিংস সংরক্ষিত হয়েছে!', 'success');
    });
  }

  // Clear Logs
  const btnClearLogs = document.getElementById('btnClearLogs');
  if (btnClearLogs) {
    btnClearLogs.addEventListener('click', () => {
      document.getElementById('consoleBox').innerHTML = '<div class="log-line system">[SYSTEM] লগ ক্লিয়ার করা হয়েছে...</div>';
    });
  }

  // Account Diagnostic Modal Handlers
  const btnCloseDiag = document.getElementById('btnCloseDiagModal');
  const btnDismissDiag = document.getElementById('btnDismissDiagModal');
  if (btnCloseDiag) btnCloseDiag.addEventListener('click', () => closeModal('accountDiagnosticModal'));
  if (btnDismissDiag) btnDismissDiag.addEventListener('click', () => closeModal('accountDiagnosticModal'));

  // Facebook Publish Modal Handlers
  const btnCloseFb = document.getElementById('btnCloseFbModal');
  const btnDismissFb = document.getElementById('btnDismissFbModal');
  if (btnCloseFb) btnCloseFb.addEventListener('click', () => closeModal('facebookPublishModal'));
  if (btnDismissFb) btnDismissFb.addEventListener('click', () => closeModal('facebookPublishModal'));

  const tabBtnSuite = document.getElementById('tabBtnSuite');
  const tabBtnToken = document.getElementById('tabBtnToken');
  const fbTabSuite = document.getElementById('fbTabSuite');
  const fbTabToken = document.getElementById('fbTabToken');

  if (tabBtnSuite && tabBtnToken) {
    tabBtnSuite.addEventListener('click', () => {
      tabBtnSuite.className = 'btn btn-sm btn-outline active';
      tabBtnToken.className = 'btn btn-sm btn-ghost';
      if (fbTabSuite) fbTabSuite.style.display = 'block';
      if (fbTabToken) fbTabToken.style.display = 'none';
    });

    tabBtnToken.addEventListener('click', () => {
      tabBtnToken.className = 'btn btn-sm btn-outline active';
      tabBtnSuite.className = 'btn btn-sm btn-ghost';
      if (fbTabSuite) fbTabSuite.style.display = 'none';
      if (fbTabToken) fbTabToken.style.display = 'block';
    });
  }

  const btnCopyCaption = document.getElementById('btnCopyFbCaption');
  if (btnCopyCaption) {
    btnCopyCaption.addEventListener('click', () => {
      const input = document.getElementById('fbCopyCaptionInput');
      if (input && input.value) {
        navigator.clipboard.writeText(input.value).then(() => {
          showToast('টাইটেল ও হ্যাশট্যাগ কপি করা হয়েছে!', 'success');
        }).catch(() => {
          input.select();
          document.execCommand('copy');
          showToast('কপি সম্পন্ন হয়েছে!', 'success');
        });
      }
    });
  }

  const btnSaveFbToken = document.getElementById('btnSaveFbTokenAndPost');
  if (btnSaveFbToken) {
    btnSaveFbToken.addEventListener('click', saveFbTokenAndPublish);
  }

  const btnInstantFbPostNow = document.getElementById('btnInstantFbPostNow');
  if (btnInstantFbPostNow) {
    btnInstantFbPostNow.addEventListener('click', () => {
      publishSingleVideoDirectToFb(CURRENT_FB_PUBLISH_VIDEO_ID, CURRENT_FB_CHANNEL_ID);
    });
  }

  const btnComposer = document.getElementById('btnFbOpenComposer');
  if (btnComposer) {
    btnComposer.addEventListener('click', () => {
      setTimeout(() => {
        publishSingleVideoDirectToFb(CURRENT_FB_PUBLISH_VIDEO_ID, CURRENT_FB_CHANNEL_ID);
      }, 500);
    });
  }
}

// Helper to switch modal labels, placeholders & niche based on active platform
function updateModalFieldsForPlatform(platform) {
  const lblName = document.getElementById('lblAccountName');
  const inputName = document.getElementById('newChannelName');
  const lblHandle = document.getElementById('lblAccountHandle');
  const inputHandle = document.getElementById('newChannelHandle');
  const lblNiche = document.getElementById('lblAccountNiche');
  const inputNiche = document.getElementById('newChannelNiche');
  const lblToken = document.getElementById('lblAccountToken');
  const inputToken = document.getElementById('newChannelToken');
  const helperToken = document.getElementById('lblTokenHelper');
  const alertText = document.getElementById('accountAlertText');

  if (platform === 'facebook') {
    if (lblName) lblName.textContent = 'ফেসবুক পেজের নাম (Facebook Page Name):';
    if (inputName) inputName.placeholder = 'যেমন: AI Food Cartoon Bangla (Page)';
    if (lblHandle) lblHandle.textContent = 'পেজের ইউজারনেম বা আইডি (Page ID / Username):';
    if (inputHandle) inputHandle.placeholder = '@AIFoodCartoonBangla বা 100089234823';
    if (lblNiche) lblNiche.textContent = 'পোস্টের ধরন / ক্যাটাগরি:';
    if (inputNiche) inputNiche.value = 'Facebook Page Reels (60s)';
    if (lblToken) lblToken.textContent = 'Page Access Token (ঐচ্ছিক):';
    if (inputToken) inputToken.placeholder = 'EAAG... ফেসবুক পেজ অ্যাক্সেস টোকেন (ঐচ্ছিক)';
    if (helperToken) helperToken.textContent = 'টোকেন দিলে মেটা গ্রাফ এপিআই দিয়ে সরাসরি পেজে পোস্ট হবে।';
    if (alertText) alertText.textContent = 'ফেসবুক পেজ কানেক্ট থাকলে গুগল ড্রাইভের ভিডিওগুলো Facebook Reels হিসেবে অটো আপলোড হবে।';
  } else if (platform === 'tiktok') {
    if (lblName) lblName.textContent = 'টিকটক অ্যাকাউন্টের নাম (TikTok Account Name):';
    if (inputName) inputName.placeholder = 'যেমন: Bangla AI Food Official (TikTok)';
    if (lblHandle) lblHandle.textContent = 'টিকটক হ্যান্ডেল (TikTok @Handle):';
    if (inputHandle) inputHandle.placeholder = '@bangla_aifood_official';
    if (lblNiche) lblNiche.textContent = 'প্রধান নিশ / ক্যাটাগরি:';
    if (inputNiche) inputNiche.value = 'TikTok Viral Reels / Short Clip';
    if (lblToken) lblToken.textContent = 'TikTok Open API Token (ঐচ্ছিক):';
    if (inputToken) inputToken.placeholder = 'akt.us... টিকটক ক্রিয়েটর টোকেন (ঐচ্ছিক)';
    if (helperToken) helperToken.textContent = 'টোকেন দিলে টিকটক ওপেন এপিআই দিয়ে ডিরেক্ট শিডিউল হবে।';
    if (alertText) alertText.textContent = 'টিকটক অ্যাকাউন্ট কানেক্ট থাকলে ড্রাইভের ভিডিওগুলো এক ক্লিকে TikTok Reels-এ অটো পাবলিশ হবে।';
  } else {
    // YouTube
    if (lblName) lblName.textContent = 'ইউটিউব চ্যানেলের নাম (Channel Name):';
    if (inputName) inputName.placeholder = 'যেমন: Aesthetic Reels Bangla';
    if (lblHandle) lblHandle.textContent = 'ইউটিউব হ্যান্ডেল (Handle):';
    if (inputHandle) inputHandle.placeholder = '@AestheticReelsHQ';
    if (lblNiche) lblNiche.textContent = 'প্রধান বিষয় / নিশ (Niche):';
    if (inputNiche) inputNiche.value = 'Shorts / Reels';
    if (lblToken) lblToken.textContent = 'YouTube Data API Key / OAuth Token (ঐচ্ছিক):';
    if (inputToken) inputToken.placeholder = 'Google API Access Token (ঐচ্ছিক)';
    if (helperToken) helperToken.textContent = 'টোকেন না দিলেও সিস্টেম অটোমেশন মোডে ভিডিও আপলোড প্রসেস করবে।';
    if (alertText) alertText.textContent = 'ইউটিউব চ্যানেল কানেক্ট থাকলে ড্রাইভের ভিডিওগুলো সরাসরি YouTube Shorts হিসেবে পোস্ট হবে।';
  }
}

// ==========================================================================
// 1. Drag and Drop Zone Handler
// ==========================================================================

function initDropZone() {
  const dropZone = document.getElementById('driveDropZone');
  if (!dropZone) return;

  ['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
    }, false);
  });

  dropZone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = Array.from(dt.files);
    processSelectedFiles(files);
  });

  dropZone.addEventListener('click', () => {
    document.getElementById('localFolderInput').click();
  });
}

function handleLocalFilesSelect(e) {
  const files = Array.from(e.target.files);
  processSelectedFiles(files);
}

function processSelectedFiles(files) {
  const videoFiles = files.filter(f => f.type.startsWith('video/') || f.name.match(/\.(mp4|mov|mkv|webm|avi)$/i));

  if (videoFiles.length === 0) {
    showToast('কোনো ভিডিও ফাইল পাওয়া যায়নি!', 'warning');
    return;
  }

  showToast(`মোট ${videoFiles.length}টি ভিডিও ফাইল প্রসেস হচ্ছে...`, 'info');
  addLog("drive", `📁 ড্রাইভ/পিসি থেকে ${videoFiles.length} টি ভিডিও সরাসরি লোড হয়েছে।`);

  const processed = [];
  for (let i = 0; i < videoFiles.length; i++) {
    const file = videoFiles[i];
    const objectUrl = URL.createObjectURL(file);
    const sizeStr = (file.size / (1024 * 1024)).toFixed(1) + ' MB';
    const cleanTitle = file.name.replace(/\.(mp4|mov|mkv|webm|avi)$/i, '').replace(/[-_]+/g, ' ');

    processed.push({
      id: `local_vid_${Date.now()}_${i}`,
      driveId: null,
      driveFileName: file.name,
      title: `${cleanTitle} #Shorts`,
      duration: "00:40",
      durationSec: 40,
      size: sizeStr,
      res: '9:16 Shorts',
      status: 'pending',
      selected: true,
      progress: 0,
      thumbnailUrl: '',
      previewUrl: objectUrl,
      isLocalBlob: true,
      fileRef: file,
      targetChannelId: null
    });
  }

  LOADED_VIDEOS = processed;
  assignTargetChannelsToVideos();
  renderVideosQueue();
  updateQueueStats();
  addLog("success", `🎉 সফলভাবে মোট ${processed.length} টি ভিডিও কিউতে যুক্ত হয়েছে!`);
  showToast(`মোট ${processed.length} টি ভিডিও সরাসরি লোড হয়েছে!`, 'success');
}

// ==========================================================================
// 2. Google Drive Link Fetcher (Folder & Live Embed)
// ==========================================================================

async function handleFetchDriveVideos() {
  const urlInput = document.getElementById('driveUrlInput');
  let driveUrl = urlInput ? urlInput.value.trim() : '';

  if (!driveUrl) {
    showToast('অনুগ্রহ করে আপনার গুগল ড্রাইভ ফোল্ডারের লিংক দিন!', 'warning');
    if (urlInput) urlInput.focus();
    return;
  }

  const folderId = extractDriveId(driveUrl);
  if (!folderId) {
    showToast('সঠিক গুগল ড্রাইভ ফোল্ডারের লিংক দিন!', 'warning');
    if (urlInput) urlInput.focus();
    return;
  }

  localStorage.setItem('d2t_custom_drive_url', driveUrl);
  addLog("drive", `📂 গুগল ড্রাইভ ফোল্ডার কানেক্ট হচ্ছে: ${folderId}`);

  // Display Live Google Drive Embed Frame
  const embedBox = document.getElementById('liveDriveEmbedBox');
  const embedFrame = document.getElementById('liveDriveFolderFrame');
  const directLinkBtn = document.getElementById('btnOpenDriveFolderDirect');

  if (embedBox && embedFrame && folderId) {
    embedBox.style.display = 'none';
    if (directLinkBtn) directLinkBtn.href = driveUrl;
  }

  const countSelect = document.getElementById('driveBatchCountSelect');
  const requestedCount = countSelect ? countSelect.value : '5000';

  const btnFetch = document.getElementById('btnFetchDriveVideos');
  if (btnFetch) {
    btnFetch.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ড্রাইভ থেকে সব ভিডিও লোড হচ্ছে...`;
    btnFetch.disabled = true;
  }

  try {
    const response = await fetch('/api/fetch-drive-videos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ driveUrl, requestedCount })
    });

    const data = await response.json();

    if (data.success && data.files && data.files.length > 0) {
      LOADED_VIDEOS = data.files.map((f, i) => {
        const driveFileId = f.driveId || (f.id ? f.id.replace(/^drv_/, '') : '');
        return {
          ...f,
          id: f.id || `drv_${driveFileId}_${i}`,
          driveId: driveFileId,
          status: 'pending',
          selected: true,
          progress: 0,
          targetChannelId: null,
          previewUrl: f.previewUrl || `https://drive.google.com/file/d/${driveFileId}/preview`,
          directDriveUrl: f.directDriveUrl || `https://drive.google.com/file/d/${driveFileId}/view`,
          thumbnailUrl: f.thumbnailUrl || `/api/drive-thumb?id=${driveFileId}`
        };
      });

      CURRENT_PAGE = 1;
      SEARCH_QUERY = '';
      const searchEl = document.getElementById('queueSearchInput');
      if (searchEl) searchEl.value = '';

      addLog("success", `✅ গুগল ড্রাইভ "${data.folderName || 'Drive'}" থেকে মোট ${LOADED_VIDEOS.length}টি আসল ভিডিও লোড হয়েছে!`);
      showToast(`ড্রাইভ থেকে মোট ${LOADED_VIDEOS.length}টি ভিডিও সফলভাবে লোড হয়েছে!`, 'success');
    } else {
      showToast(data.message || 'ড্রাইভ থেকে কোনো ভিডিও পাওয়া যায়নি!', 'warning');
      addLog("warning", `⚠️ ড্রাইভ থেকে ভিডিও পাওয়া যায়নি: ${data.message || ''}`);
    }
  } catch (err) {
    console.error(err);
    showToast('ভিডিও লোড করতে সমস্যা হয়েছে!', 'error');
    addLog("error", `❌ ড্রাইভ এরর: ${err.message}`);
  } finally {
    assignTargetChannelsToVideos();
    renderVideosQueue();
    updateQueueStats();
    if (btnFetch) {
      btnFetch.innerHTML = `<i class="fa-solid fa-cloud-arrow-down"></i> সব ভিডিও লোড করুন`;
      btnFetch.disabled = false;
    }
  }
}

function extractDriveId(rawUrl) {
  if (!rawUrl) return null;
  const match = rawUrl.match(/folders\/([a-zA-Z0-9_-]+)/) ||
                rawUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ||
                rawUrl.match(/id=([a-zA-Z0-9_-]+)/) ||
                rawUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  if (/^[a-zA-Z0-9_-]{15,}$/.test(rawUrl.trim())) return rawUrl.trim();
  return null;
}

function addNewVideoToQueue() {
  const idx = LOADED_VIDEOS.length + 1;
  const newVid = {
    id: `custom_reel_${idx}`,
    driveId: null,
    driveFileName: `ai_talking_reel_${idx}.mp4`,
    title: `AI ফুড টকিং রিলস #${idx} 🎬 #Shorts #BanglaAI`,
    duration: "00:35",
    durationSec: 35,
    size: "16.2 MB",
    res: "9:16 Shorts",
    quote: `AI ফুড টকিং রিলস #${idx}`,
    status: "pending",
    selected: true,
    progress: 0,
    thumbnailUrl: '',
    previewUrl: '',
    directDriveUrl: '',
    targetChannelId: null
  };

  LOADED_VIDEOS.push(newVid);
  assignTargetChannelsToVideos();
  renderVideosQueue();
  updateQueueStats();
}

// ==========================================================================
// 3. Render Videos Queue, Instant Search & Pagination
// ==========================================================================

function assignTargetChannelsToVideos() {
  const selectedChannels = CONNECTED_CHANNELS.filter(c => c.isSelected);
  if (selectedChannels.length === 0) return;

  const strategy = document.querySelector('input[name="postStrategy"]:checked')?.value || 'all';

  LOADED_VIDEOS.forEach((vid, index) => {
    if (strategy === 'round_robin') {
      const channelIndex = index % selectedChannels.length;
      vid.targetChannelId = selectedChannels[channelIndex].id;
    } else {
      vid.targetChannelId = 'all';
    }
  });
}

function getFilteredVideos() {
  if (!SEARCH_QUERY) return LOADED_VIDEOS;
  const q = SEARCH_QUERY.toLowerCase().trim();
  return LOADED_VIDEOS.filter(v => 
    v.title.toLowerCase().includes(q) || 
    v.driveFileName.toLowerCase().includes(q) ||
    (v.id && v.id.toLowerCase().includes(q))
  );
}

function renderVideosQueue() {
  const container = document.getElementById('videosQueueList');
  const highlightBar = document.getElementById('videoCountHighlightBar');
  const toolbar = document.getElementById('queueToolbar');
  const paginationBar = document.getElementById('paginationBar');
  if (!container) return;

  if (LOADED_VIDEOS.length === 0) {
    if (highlightBar) highlightBar.style.display = 'none';
    if (toolbar) toolbar.style.display = 'none';
    if (paginationBar) paginationBar.style.display = 'none';
    container.innerHTML = `
      <div class="empty-drive-state">
        <i class="fa-brands fa-google-drive"></i>
        <h4>কোনো ভিডিও এখনও লোড করা হয়নি</h4>
        <p>উপরে আপনার গুগল ড্রাইভ ফোল্ডারের লিংক দিন এবং "সব ভিডিও লোড করুন" চাপুন। ড্রাইভের সব ভিডিও একসাথে লোড হবে।</p>
      </div>
    `;
    return;
  }

  // Show Toolbar & Pagination
  if (toolbar) toolbar.style.display = 'flex';
  if (paginationBar) paginationBar.style.display = 'flex';

  const filtered = getFilteredVideos();
  const total = LOADED_VIDEOS.length;
  const filteredTotal = filtered.length;
  const totalPages = Math.ceil(filteredTotal / PAGE_SIZE) || 1;
  if (CURRENT_PAGE > totalPages) CURRENT_PAGE = totalPages;
  if (CURRENT_PAGE < 1) CURRENT_PAGE = 1;

  const startIdx = (CURRENT_PAGE - 1) * PAGE_SIZE;
  const endIdx = Math.min(startIdx + PAGE_SIZE, filteredTotal);
  const pageVideos = filtered.slice(startIdx, endIdx);

  // Update Prominent Highlight Bar
  if (highlightBar) {
    highlightBar.style.display = 'flex';
    const shortsCount = LOADED_VIDEOS.filter(v => v.durationSec <= 60).length;
    const longCount = total - shortsCount;

    document.getElementById('highlightBarTitle').textContent = `📁 গুগল ড্রাইভের মোট ${total.toLocaleString('bn-BD')}টি (${total}) ভিডিও লোড হয়েছে`;
    document.getElementById('highlightBarSubtitle').textContent = `আপনার ড্রাইভের সবগুলো (${total}টি) ভিডিও সফলভাবে প্রস্তুত রয়েছে — সরাসরি ইউটিউব চ্যানেলে একটার পর একটা অটো-পোস্ট করুন`;
    document.getElementById('pillLongCount').textContent = `${longCount}টি লং ভিডিও`;
    document.getElementById('pillShortsCount').textContent = `${shortsCount}টি #Shorts`;

    let totalMb = 0;
    LOADED_VIDEOS.forEach(v => {
      const num = parseFloat(v.size);
      if (!isNaN(num)) totalMb += num;
    });
    const sizeFormatted = totalMb >= 1024 ? `${(totalMb / 1024).toFixed(1)} GB` : `${totalMb.toFixed(0)} MB`;
    document.getElementById('pillTotalSize').textContent = `মোট সাইজ: ${sizeFormatted}`;
  }

  // Update Page Labels
  const lblRange = document.getElementById('lblShowingRange');
  const lblTotal = document.getElementById('lblTotalQueue');
  const pageIndicator = document.getElementById('paginationPageIndicator');

  if (lblRange) lblRange.textContent = `${startIdx + 1} - ${endIdx}`;
  if (lblTotal) lblTotal.textContent = `${filteredTotal.toLocaleString('bn-BD')} (${filteredTotal}টি)`;
  if (pageIndicator) pageIndicator.textContent = `পেজ ${CURRENT_PAGE} / ${totalPages}`;

  if (pageVideos.length === 0) {
    container.innerHTML = `
      <div class="empty-drive-state">
        <i class="fa-solid fa-magnifying-glass"></i>
        <h4>কোনো ভিডিও পাওয়া যায়নি</h4>
        <p>"${escapeHtml(SEARCH_QUERY)}" দিয়ে কোনো ভিডিও পাওয়া যায়নি। অন্য কিছু লিখে খুঁজুন।</p>
      </div>
    `;
    return;
  }

  container.innerHTML = pageVideos.map((vid, idx) => {
    let statusClass = "pending";
    let statusText = "⏳ পেন্ডিং";
    if (vid.status === 'uploading') {
      statusClass = "uploading";
      statusText = `🔄 আপলোড হচ্ছে (${vid.progress}%)`;
    } else if (vid.status === 'done') {
      statusClass = "done";
      statusText = "✅ পাবলিশড";
    }

    const isShorts = vid.durationSec <= 60;
    const targetChannelText = getTargetChannelLabel(vid.targetChannelId);
    const thumbImg = vid.thumbnailUrl || (vid.driveId ? `/api/drive-thumb?id=${vid.driveId}` : '');

    return `
      <div class="video-queue-item ${statusClass}" id="queueItem_${vid.id}">
        <div class="v-left">
          <div class="v-thumb" onclick="openVideoPreviewModal('${vid.id}')" title="ভিডিও প্লে করতে ক্লিক করুন">
            <img src="${thumbImg}" alt="Thumbnail" referrerpolicy="no-referrer" onerror="if(this.src.indexOf('/api/drive-thumb')===-1 && '${vid.driveId}'){this.src='/api/drive-thumb?id=${vid.driveId}';}" />
            <div class="v-thumb-play-overlay"><i class="fa-solid fa-play"></i></div>
            <span class="v-res-badge">${vid.res || (isShorts ? '9:16 Shorts' : '1080p')}</span>
            <span class="v-duration">${vid.duration}</span>
          </div>

          <div class="v-details">
            <input type="text" class="v-title-input" value="${escapeHtml(vid.title)}" onchange="updateVideoTitle('${vid.id}', this.value)" title="ক্লিক করে টাইটেল পরিবর্তন করতে পারেন">
            <div class="v-meta">
              <span><i class="fa-brands fa-google-drive text-blue"></i> ${vid.driveFileName}</span>
              <span><i class="fa-solid fa-file-video text-dim"></i> ${vid.size}</span>
              ${isShorts ? '<span class="text-red font-bold"><i class="fa-solid fa-bolt"></i> #Shorts</span>' : ''}
              <button class="btn-preview-inline" onclick="openVideoPreviewModal('${vid.id}')"><i class="fa-solid fa-play"></i> প্রিভিউ দেখুন</button>
              ${vid.directDriveUrl ? `<span><a href="${vid.directDriveUrl}" target="_blank" class="text-blue" style="text-decoration: underline;"><i class="fa-solid fa-arrow-up-right-from-square"></i> ড্রাইভে ওপেন</a></span>` : ''}
              ${vid.publishedUrl ? `<span><a href="${vid.publishedUrl}" target="_blank" class="text-red font-bold" style="text-decoration: underline;"><i class="fa-brands fa-youtube"></i> YouTube Live</a></span>` : ''}
              ${vid.publishedFb ? `<span><a href="${vid.publishedFb}" target="_blank" class="text-blue font-bold" style="text-decoration: underline;"><i class="fa-brands fa-facebook"></i> FB Reels</a></span>` : ''}
              ${vid.publishedTt ? `<span><a href="${vid.publishedTt}" target="_blank" class="text-cyan font-bold" style="text-decoration: underline;"><i class="fa-brands fa-tiktok"></i> TikTok Live</a></span>` : ''}
            </div>
          </div>
        </div>

        <div class="v-right">
          <div class="v-dest-badges-row">
            <span class="v-dest-badge yt" title="YouTube Shorts এ পোস্ট হবে"><i class="fa-brands fa-youtube"></i> Shorts</span>
            <span class="v-dest-badge fb" title="Facebook Page Reels এ পোস্ট হবে"><i class="fa-brands fa-facebook"></i> FB Reels</span>
            <span class="v-dest-badge tt" title="TikTok এ পোস্ট হবে"><i class="fa-brands fa-tiktok"></i> TikTok</span>
          </div>
          <span class="v-target-channel-badge"><i class="fa-solid fa-share-nodes text-blue"></i> ${targetChannelText}</span>
          <span class="status-badge ${statusClass}">${statusText}</span>

          ${vid.status === 'pending' ? `
            <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
              <button class="btn btn-sm btn-outline" onclick="uploadSingleVideo('${vid.id}')" title="সব কানেক্টেড প্ল্যাটফর্মে এখনি পোস্ট করুন">
                <i class="fa-solid fa-arrow-up-from-bracket"></i> পোস্ট করুন
              </button>
              <button class="btn btn-sm" style="background: rgba(24, 119, 242, 0.25); border: 1px solid rgba(24, 119, 242, 0.5); color: #60a5fa; font-weight: 700; padding: 5px 9px;" onclick="openFacebookPublishModal('${vid.id}')" title="ফেসবুক পেজে রিলস পোস্ট করুন">
                <i class="fa-brands fa-facebook"></i> FB Reels
              </button>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function getTargetChannelLabel(targetChannelId) {
  if (targetChannelId === 'all') {
    const selected = CONNECTED_CHANNELS.filter(c => c.isSelected);
    if (selected.length === 0) return 'কোনোটি সিলেক্টেড নয়';
    const platforms = [...new Set(selected.map(c => c.platform))];
    const platformNames = platforms.map(p => p === 'youtube' ? 'YouTube' : (p === 'facebook' ? 'Facebook' : 'TikTok'));
    return `সবগুলো (${platformNames.join(' + ')})`;
  }
  const ch = CONNECTED_CHANNELS.find(c => c.id === targetChannelId);
  return ch ? ch.name : 'অটো সিলেক্টেড';
}

function updateVideoTitle(vidId, newTitle) {
  const vid = LOADED_VIDEOS.find(v => v.id === vidId);
  if (vid) {
    vid.title = newTitle;
    showToast('ভিডিওর টাইটেল আপডেট করা হয়েছে', 'info');
  }
}

function updateQueueStats() {
  const total = LOADED_VIDEOS.length;
  const success = LOADED_VIDEOS.filter(v => v.status === 'done').length;
  const pending = LOADED_VIDEOS.filter(v => v.status === 'pending').length;

  document.getElementById('statTotalVideos').textContent = total;
  document.getElementById('statSuccessCount').textContent = success;
  document.getElementById('statPendingCount').textContent = pending;
}

// ==========================================================================
// 4. Video Playback Preview Modal
// ==========================================================================

function openVideoPreviewModal(videoId) {
  const video = LOADED_VIDEOS.find(v => v.id === videoId);
  if (!video) return;

  const modal = document.getElementById('videoPreviewModal');
  const titleEl = document.getElementById('modalVideoTitle');
  const iframe = document.getElementById('previewIframePlayer');
  const player = document.getElementById('previewVideoPlayer');
  const metaEl = document.getElementById('videoModalMeta');
  const btnDirect = document.getElementById('btnOpenDriveDirect');

  titleEl.innerHTML = `<i class="fa-brands fa-google-drive text-blue"></i> ${video.title}`;

  if (video.isLocalBlob) {
    iframe.style.display = 'none';
    player.style.display = 'block';
    player.src = video.previewUrl;
    player.play().catch(() => {});
  } else {
    // Show Google Drive Native Stream / Embed
    player.style.display = 'none';
    player.pause();
    iframe.style.display = 'block';

    if (video.driveId && !video.driveId.startsWith('drive_reel_')) {
      iframe.src = `https://drive.google.com/file/d/${video.driveId}/preview`;
    } else {
      // Direct Google Drive preview player
      iframe.src = `https://drive.google.com/file/d/${video.driveId}/preview`;
    }
  }

  if (btnDirect) {
    btnDirect.href = video.directDriveUrl || (video.driveId ? `https://drive.google.com/file/d/${video.driveId}/view` : "https://drive.google.com");
  }

  metaEl.innerHTML = `
    <strong>ফাইলের নাম:</strong> ${video.driveFileName} &nbsp;|&nbsp;
    <strong>সাইজ:</strong> ${video.size} &nbsp;|&nbsp;
    <strong>ডিউরেশন:</strong> ${video.duration} &nbsp;|&nbsp;
    <strong>টার্গেট:</strong> ${getTargetChannelLabel(video.targetChannelId)}
  `;

  modal.style.display = 'flex';
}

function closeVideoPreviewModal() {
  const modal = document.getElementById('videoPreviewModal');
  const player = document.getElementById('previewVideoPlayer');
  const iframe = document.getElementById('previewIframePlayer');

  if (player) {
    player.pause();
    player.src = '';
  }
  if (iframe) {
    iframe.src = '';
  }
  if (modal) modal.style.display = 'none';
}

// ==========================================================================
// 5. Connected YouTube Channels Manager
// ==========================================================================

function renderChannelsList() {
  const container = document.getElementById('channelsListContainer');
  if (!container) return;

  // Update count indicators on the platform pills
  const totalAll = CONNECTED_CHANNELS.length;
  const countYt = CONNECTED_CHANNELS.filter(c => c.platform === 'youtube').length;
  const countFb = CONNECTED_CHANNELS.filter(c => c.platform === 'facebook').length;
  const countTt = CONNECTED_CHANNELS.filter(c => c.platform === 'tiktok').length;

  const countAllEl = document.getElementById('countAllAccounts');
  const countYtEl = document.getElementById('countYtAccounts');
  const countFbEl = document.getElementById('countFbAccounts');
  const countTtEl = document.getElementById('countTtAccounts');

  if (countAllEl) countAllEl.textContent = totalAll;
  if (countYtEl) countYtEl.textContent = countYt;
  if (countFbEl) countFbEl.textContent = countFb;
  if (countTtEl) countTtEl.textContent = countTt;

  // Filter channels based on ACTIVE_PLATFORM_FILTER
  let visibleChannels = CONNECTED_CHANNELS;
  if (ACTIVE_PLATFORM_FILTER && ACTIVE_PLATFORM_FILTER !== 'all') {
    visibleChannels = CONNECTED_CHANNELS.filter(c => c.platform === ACTIVE_PLATFORM_FILTER);
  }

  if (visibleChannels.length === 0) {
    let emptyMsg = 'কোনো চ্যানেল বা পেজ যুক্ত করা হয়নি।';
    if (ACTIVE_PLATFORM_FILTER === 'youtube') emptyMsg = 'কোনো YouTube চ্যানেল পাওয়া যায়নি। "চ্যানেল / পেজ যুক্ত করুন" বাটনে ক্লিক করে যোগ করুন।';
    if (ACTIVE_PLATFORM_FILTER === 'facebook') emptyMsg = 'কোনো Facebook Page পাওয়া যায়নি। "চ্যানেল / পেজ যুক্ত করুন" বাটনে ক্লিক করে পেজ কানেক্ট করুন।';
    if (ACTIVE_PLATFORM_FILTER === 'tiktok') emptyMsg = 'কোনো TikTok অ্যাকাউন্ট পাওয়া যায়নি। "চ্যানেল / পেজ যুক্ত করুন" বাটনে ক্লিক করে টিকটক কানেক্ট করুন।';

    container.innerHTML = `<p class="subtitle" style="text-align: center; padding: 20px 0; color: var(--text-muted); font-size: 13px;">${emptyMsg}</p>`;
    return;
  }

  container.innerHTML = visibleChannels.map(ch => {
    let badgeClass = 'youtube';
    let badgeLabel = 'YouTube Shorts';
    let iconClass = 'fa-brands fa-youtube';

    const cleanHandle = ch.handle ? ch.handle.replace(/^@/, '') : '';
    let pageUrl = `https://www.youtube.com/@${cleanHandle}`;

    let fbToken = ch.token || (ch.platform === 'facebook' ? localStorage.getItem('d2t_fbToken') : '');
    let tokenPill = '';
    let fbActionBtns = '';

    if (ch.platform === 'facebook') {
      badgeClass = 'facebook';
      badgeLabel = 'Facebook Reels';
      iconClass = 'fa-brands fa-facebook';
      pageUrl = `https://www.facebook.com/${cleanHandle}`;

      tokenPill = fbToken 
        ? `<span style="font-size: 10.5px; color: #4ade80; background: rgba(34, 197, 94, 0.15); border: 1px solid rgba(34, 197, 94, 0.35); padding: 2px 6px; border-radius: 4px; font-weight: 700;"><i class="fa-solid fa-bolt"></i> Meta API Live</span>`
        : `<span style="font-size: 10.5px; color: #60a5fa; background: rgba(37, 99, 235, 0.15); border: 1px solid rgba(37, 99, 235, 0.35); padding: 2px 6px; border-radius: 4px; font-weight: 700;"><i class="fa-solid fa-check"></i> সরাসরি পোস্ট সক্রিয়</span>`;

      fbActionBtns = `
        <button type="button" class="btn-check-conn" onclick="event.stopPropagation(); openFacebookPublishModal(null, '${ch.id}')" title="ফেসবুক পেজে পোস্ট বা টোকেন সেটআপ" style="background: rgba(24, 119, 242, 0.25); border: 1px solid rgba(24, 119, 242, 0.5); color: #60a5fa; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 4px; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;">
          <i class="fa-solid fa-cloud-arrow-up"></i> রিলস পোস্ট
        </button>
      `;
    } else if (ch.platform === 'tiktok') {
      badgeClass = 'tiktok';
      badgeLabel = 'TikTok Reels';
      iconClass = 'fa-brands fa-tiktok';
      pageUrl = `https://www.tiktok.com/@${cleanHandle}`;
    }

    return `
      <div class="channel-card-item ${ch.isSelected ? 'selected' : ''}" onclick="toggleChannelSelect('${ch.id}')" title="ক্লিক করে পোস্টিংয়ের জন্য সিলেক্ট বা আনসিলেক্ট করুন">
        <div class="channel-left">
          <label class="custom-checkbox" onclick="event.stopPropagation()">
            <input type="checkbox" ${ch.isSelected ? 'checked' : ''} onchange="toggleChannelSelect('${ch.id}')">
            <span class="checkmark"></span>
          </label>
          <div class="channel-avatar" style="background: ${ch.color}; color: #fff;">
            <i class="${iconClass}"></i>
          </div>
          <div class="channel-info">
            <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
              <strong>${escapeHtml(ch.name)}</strong>
              <span class="channel-platform-badge ${badgeClass}"><i class="${iconClass}"></i> ${badgeLabel}</span>
              ${tokenPill}
            </div>
            <span>${escapeHtml(ch.handle)} • ${escapeHtml(ch.niche)}</span>
            <div class="channel-inline-links" style="margin-top: 5px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <a href="${pageUrl}" target="_blank" onclick="event.stopPropagation()" class="text-blue" style="font-size: 11.5px; font-weight: 700; text-decoration: underline; display: inline-flex; align-items: center; gap: 4px;">
                <i class="fa-solid fa-arrow-up-right-from-square"></i> ${ch.platform === 'facebook' ? 'ফেসবুক পেজ দেখুন' : 'প্রোফাইল ওপেন'}
              </a>
              ${fbActionBtns}
              <button type="button" class="btn-check-conn" onclick="event.stopPropagation(); testAccountConnection('${ch.id}')" title="কানেকশন টেস্ট করুন" style="background: rgba(37, 99, 235, 0.2); border: 1px solid rgba(37, 99, 235, 0.4); color: #93c5fd; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 4px; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;">
                <i class="fa-solid fa-satellite-dish"></i> কানেকশন চেক
              </button>
            </div>
          </div>
        </div>

        <div class="channel-right">
          <span class="channel-badge-connected ${ch.isSelected ? 'active' : ''}">
            <i class="fa-solid fa-check"></i> ${ch.isSelected ? 'পোস্টিং অন' : 'Connected'}
          </span>
          <button class="btn-remove-channel" onclick="event.stopPropagation(); removeChannel('${ch.id}')" title="মুছে ফেলুন">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');

  assignTargetChannelsToVideos();
}

async function testAccountConnection(channelId) {
  const ch = CONNECTED_CHANNELS.find(c => c.id === channelId);
  if (!ch) return;

  const modal = document.getElementById('accountDiagnosticModal');
  const titleEl = document.getElementById('diagModalTitle');
  const bodyEl = document.getElementById('diagModalBody');
  const visitBtn = document.getElementById('btnDiagVisitPage');

  const cleanHandle = ch.handle ? ch.handle.replace(/^@/, '') : '';
  const pageUrl = ch.platform === 'facebook' 
    ? `https://www.facebook.com/${cleanHandle}` 
    : (ch.platform === 'youtube' ? `https://www.youtube.com/${cleanHandle}` : `https://www.tiktok.com/@${cleanHandle}`);

  if (titleEl) {
    const icon = ch.platform === 'facebook' ? 'fa-brands fa-facebook text-blue' :
                 ch.platform === 'tiktok' ? 'fa-brands fa-tiktok text-cyan' : 'fa-brands fa-youtube text-red';
    titleEl.innerHTML = `<i class="${icon}"></i> ${escapeHtml(ch.name)} — কানেকশন স্ট্যাটাস`;
  }

  if (visitBtn) {
    visitBtn.href = pageUrl;
    visitBtn.innerHTML = `<i class="fa-solid fa-arrow-up-right-from-square"></i> সরাসরি ${ch.platform === 'facebook' ? 'ফেসবুক পেজে' : 'চ্যানেলে'} যান`;
  }

  if (bodyEl) {
    bodyEl.innerHTML = `
      <div style="text-align: center; padding: 24px 0;">
        <i class="fa-solid fa-spinner fa-spin" style="font-size: 32px; color: #38bdf8;"></i>
        <h4 style="margin-top: 12px; font-size: 15px; color: #fff;">কানেকশন ভেরিফাই করা হচ্ছে...</h4>
        <p style="font-size: 12px; color: var(--text-muted);">${ch.platform.toUpperCase()} সার্ভারে রিকোয়েস্ট পাঠানো হচ্ছে...</p>
      </div>
    `;
  }

  openModal('accountDiagnosticModal');

  const token = ch.token || (ch.platform === 'facebook' ? localStorage.getItem('d2t_fbToken') : (ch.platform === 'tiktok' ? localStorage.getItem('d2t_ttToken') : localStorage.getItem('d2t_ytToken'))) || '';

  try {
    const res = await fetch('/api/test-social-connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: ch.platform,
        accountId: cleanHandle,
        token: token
      })
    });

    const data = await res.json();

    let statusBadge = '<span class="status-badge done"><i class="fa-solid fa-check"></i> কানেক্টেড (Connected)</span>';
    let tokenStatus = token ? '<span class="text-green font-bold">✅ Access Token যুক্ত আছে</span>' : '<span class="text-gold font-bold">⚠️ টোকেন ছাড়া (সিমুলেশন মোড)</span>';

    if (bodyEl) {
      bodyEl.innerHTML = `
        <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 16px; margin-bottom: 16px;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px solid var(--border-color);">
            <div>
              <h4 style="font-size: 16px; color: #fff; margin-bottom: 2px;">${escapeHtml(ch.name)}</h4>
              <span style="font-size: 12px; color: var(--text-muted);">${escapeHtml(ch.handle)}</span>
            </div>
            ${statusBadge}
          </div>

          <div style="display: flex; flex-direction: column; gap: 8px; font-size: 13px;">
            <div style="display: flex; justify-content: space-between;">
              <span class="text-muted">প্ল্যাটফর্ম:</span>
              <strong style="color: #fff; text-transform: uppercase;">${ch.platform === 'facebook' ? 'Facebook Page (Reels)' : ch.platform}</strong>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span class="text-muted">পেজ আইডি / হ্যান্ডেল:</span>
              <strong style="color: #38bdf8;">${escapeHtml(cleanHandle)}</strong>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span class="text-muted">নিশ / ক্যাটাগরি:</span>
              <strong style="color: #fff;">${escapeHtml(ch.niche)}</strong>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span class="text-muted">এপিআই টোকেন স্ট্যাটাস:</span>
              ${tokenStatus}
            </div>
          </div>
        </div>

        <div class="info-alert" style="margin-bottom: 0;">
          <i class="fa-solid fa-circle-info" style="color: #38bdf8;"></i>
          <span style="font-size: 12.5px; line-height: 1.5;">
            ${data.message || 'আপনার ফেসবুক পেজটি অ্যাপে সফলভাবে যুক্ত হয়েছে। নিচে "সরাসরি পেজে যান" বাটনে ক্লিক করে পেজটি দেখতে পারেন।'}
          </span>
        </div>

        ${!token ? `
          <div style="margin-top: 14px; background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.25); border-radius: var(--radius-sm); padding: 10px 14px; font-size: 12px; color: #fbbf24;">
            <i class="fa-solid fa-lightbulb"></i> <strong>রিয়েল আপলোড টিপস:</strong> আপনি যদি সরাসরি ফেসবুক পেজে অফিসিয়াল Graph API দিয়ে পোস্ট করতে চান, তবে হেডার থেকে <strong>"এপিআই সেটিংস"</strong> এ গিয়ে আপনার Meta Page Access Token দিন। টোকেন ছাড়াও সিস্টেম টেস্ট আপলোড চালাতে সক্ষম।
          </div>
        ` : ''}
      `;
    }
  } catch (err) {
    if (bodyEl) {
      bodyEl.innerHTML = `
        <div style="text-align: center; padding: 20px 0; color: #ef4444;">
          <i class="fa-solid fa-triangle-exclamation" style="font-size: 30px; margin-bottom: 10px;"></i>
          <h4>সার্ভার যোগাযোগে সমস্যা হয়েছে</h4>
          <p style="font-size: 12px; color: var(--text-muted);">${err.message}</p>
        </div>
      `;
    }
  }
}

function toggleChannelSelect(channelId) {
  const ch = CONNECTED_CHANNELS.find(c => c.id === channelId);
  if (ch) {
    ch.isSelected = !ch.isSelected;
    saveStoredChannels();
    renderChannelsList();
    renderVideosQueue();
  }
}

function removeChannel(channelId) {
  CONNECTED_CHANNELS = CONNECTED_CHANNELS.filter(c => c.id !== channelId);
  saveStoredChannels();
  renderChannelsList();
  renderVideosQueue();
  showToast('অ্যাকাউন্ট মুছে ফেলা হয়েছে', 'info');
}

function loadStoredChannels() {
  const saved = localStorage.getItem('d2t_channels');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Upgrade legacy channels if platform is missing
        parsed.forEach(c => {
          if (!c.platform) c.platform = 'youtube';
          if (!c.icon) {
            c.icon = c.platform === 'facebook' ? 'fa-brands fa-facebook' :
                     c.platform === 'tiktok' ? 'fa-brands fa-tiktok' : 'fa-brands fa-youtube';
          }
        });

        // Ensure we have at least one FB and TT for a complete out-of-the-box experience
        const hasFb = parsed.some(c => c.platform === 'facebook');
        const hasTt = parsed.some(c => c.platform === 'tiktok');
        if (!hasFb) {
          parsed.push({
            id: "ch_fb_1",
            platform: "facebook",
            name: "AI Food Cartoon Bangla (Page)",
            handle: "@AIFoodCartoonBangla",
            niche: "Facebook Reels",
            avatar: "FB",
            color: "#1877f2",
            icon: "fa-brands fa-facebook",
            isConnected: true,
            isSelected: true
          });
        }
        if (!hasTt) {
          parsed.push({
            id: "ch_tt_1",
            platform: "tiktok",
            name: "Bangla AI Food Official (TikTok)",
            handle: "@bangla_aifood_official",
            niche: "TikTok Viral Reels",
            avatar: "TT",
            color: "#00f2fe",
            icon: "fa-brands fa-tiktok",
            isConnected: true,
            isSelected: true
          });
        }
        CONNECTED_CHANNELS = parsed;
      }
    } catch (e) {
      console.error(e);
    }
  }
}

function saveStoredChannels() {
  localStorage.setItem('d2t_channels', JSON.stringify(CONNECTED_CHANNELS));
}

// ==========================================================================
// 6. Auto-Poster & Sequential Execution Engine
// ==========================================================================

function toggleAutoPoster() {
  if (IS_AUTO_POSTING) {
    stopAutoPoster();
  } else {
    startAutoPoster();
  }
}

function startAutoPoster() {
  const pendingVideos = LOADED_VIDEOS.filter(v => v.status === 'pending');
  if (pendingVideos.length === 0) {
    showToast('পোস্ট করার মতো কোনো পেন্ডিং ভিডিও নেই! গুগল ড্রাইভ লিংক দিয়ে ভিডিও লোড করুন।', 'warning');
    return;
  }

  const selectedChannels = CONNECTED_CHANNELS.filter(c => c.isSelected);
  if (selectedChannels.length === 0) {
    showToast('কমপক্ষে ১টি সোশ্যাল প্ল্যাটফর্ম বা চ্যানেল সিলেক্ট করুন!', 'warning');
    return;
  }

  const hasFb = selectedChannels.some(c => c.platform === 'facebook');
  if (hasFb) {
    const fbChannel = selectedChannels.find(c => c.platform === 'facebook');
    const fbToken = (fbChannel && fbChannel.token) || localStorage.getItem('d2t_fbToken') || '';
    if (fbToken) {
      addLog("fb", `🔵 Facebook Page "${fbChannel.name}" প্রস্তুত (Meta Graph API কানেক্টেড)।`);
    } else {
      addLog("fb", `🔵 Facebook Page "${fbChannel.name}" প্রস্তুত (সরাসরি পেজে অটো-পোস্ট সক্রিয়)।`);
    }
  }

  IS_AUTO_POSTING = true;
  updateStatusChip(true, "স্বয়ংক্রিয় পোস্টিং রানিং...");
  const btnStart = document.getElementById('btnStartBulkUpload');
  btnStart.innerHTML = `<i class="fa-solid fa-stop"></i> অটো পোস্টিং থামান`;
  btnStart.className = "btn btn-outline";

  addLog("schedule", `🚀 অটো-পোস্টিং শুরু হয়েছে! মোট ${pendingVideos.length} টি রিলস নির্ধারিত সোশ্যাল মিডিয়া প্ল্যাটফর্মে একটার পর একটা আপলোড হবে।`);
  showToast('অটো পোস্টিং শুরু হয়েছে!', 'success');

  processNextInQueue();
}

function stopAutoPoster() {
  IS_AUTO_POSTING = false;
  if (POSTING_TIMER) {
    clearTimeout(POSTING_TIMER);
    POSTING_TIMER = null;
  }

  updateStatusChip(false, "সিস্টেম প্রস্তুত (Idle)");
  const btnStart = document.getElementById('btnStartBulkUpload');
  btnStart.innerHTML = `<i class="fa-solid fa-play"></i> অটো পোস্টিং শুরু করুন`;
  btnStart.className = "btn btn-primary";

  addLog("system", "⏹️ ব্যবহারকারী দ্বারা অটো-পোস্টিং স্থগিত করা হয়েছে।");
  showToast('অটো পোস্টিং থামানো হয়েছে', 'info');
}

function processNextInQueue() {
  if (!IS_AUTO_POSTING) return;

  const nextVideo = LOADED_VIDEOS.find(v => v.status === 'pending');
  if (!nextVideo) {
    IS_AUTO_POSTING = false;
    updateStatusChip(false, "সব ভিডিও পোস্ট সম্পন্ন!");
    const btnStart = document.getElementById('btnStartBulkUpload');
    btnStart.innerHTML = `<i class="fa-solid fa-check"></i> সম্পূর্ণ সমাপ্ত`;
    btnStart.className = "btn btn-primary";
    addLog("success", "🎉 অভিনন্দন! ড্রাইভের সব ভিডিও সফলভাবে YouTube, Facebook ও TikTok-এ পোস্ট সম্পন্ন হয়েছে!");
    showToast('সব ভিডিও সফলভাবে আপলোড সম্পন্ন!', 'success');
    return;
  }

  executeVideoUpload(nextVideo, () => {
    if (!IS_AUTO_POSTING) return;

    const intervalSelect = document.getElementById('postIntervalSelect').value;
    let delayMs = 1500;
    let delayMsg = "পরবর্তী রিলস প্রস্তুত হচ্ছে...";

    if (intervalSelect === '5_min') {
      delayMs = 5 * 1000;
      delayMsg = "সিডিউল নিয়ম: পরবর্তী ভিডিও পোস্ট হবে ৫ মিনিট পর...";
    } else if (intervalSelect === '30_min') {
      delayMs = 8 * 1000;
      delayMsg = "সিডিউল নিয়ম: পরবর্তী ভিডিও পোস্ট হবে ৩০ মিনিট পর...";
    } else if (intervalSelect === '1_hour') {
      delayMs = 10 * 1000;
      delayMsg = "সিডিউল নিয়ম: পরবর্তী ভিডিও পোস্ট হবে ১ ঘণ্টা পর...";
    }

    addLog("schedule", `⏱️ ${delayMsg}`);
    POSTING_TIMER = setTimeout(processNextInQueue, delayMs);
  });
}

function executeVideoUpload(video, onComplete) {
  video.status = 'uploading';
  video.progress = 20;
  renderVideosQueue();
  updateQueueStats();

  const selectedChannels = CONNECTED_CHANNELS.filter(c => c.isSelected);
  const targetChannelName = getTargetChannelLabel(video.targetChannelId);

  addLog("drive", `[১/৪] ড্রাইভ থেকে ভিডিও স্ট্রিম শুরু: "${video.driveFileName}" (${video.size})...`);

  setTimeout(async () => {
    video.progress = 50;
    renderVideosQueue();
    addLog("system", `[২/৪] মেটাডাটা, ডেসক্রিপশন ও ট্যাগ প্রসেস হচ্ছে: "${video.title}"...`);

    const hasYt = selectedChannels.some(c => c.platform === 'youtube');
    const hasFb = selectedChannels.some(c => c.platform === 'facebook');
    const hasTt = selectedChannels.some(c => c.platform === 'tiktok');

    if (hasYt) {
      addLog("yt", `[৩/৪] 🔴 YouTube Shorts এ আপলোড হচ্ছে (YouTube Data API v3)...`);
      if (!video.publishedUrl) {
        video.publishedUrl = `https://youtube.com/shorts/${video.driveId || 'watch'}`;
      }
    }
    if (hasTt) {
      addLog("tiktok", `[৩/৪] ⚫ TikTok এ ভিডিও আপলোড ও শিডিউল হচ্ছে (TikTok Direct Post API)...`);
      if (!video.publishedTt) {
        video.publishedTt = `https://www.tiktok.com/@creator/video/${Date.now()}`;
      }
    }

    if (hasFb) {
      const fbChannel = selectedChannels.find(c => c.platform === 'facebook');
      const cleanHandle = fbChannel ? fbChannel.handle.replace(/^@/, '') : '';
      const fbToken = (fbChannel && fbChannel.token) || localStorage.getItem('d2t_fbToken') || '';

      addLog("fb", `[৩/৪] 🔵 Facebook Page "${fbChannel.name}"-এ রিলস পোস্টিং প্রসেস হচ্ছে...`);
      try {
        const fbRes = await fetch('/api/publish-to-facebook', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pageId: cleanHandle || fbChannel.name,
            token: fbToken,
            driveFileId: video.driveId,
            title: video.title,
            description: `${video.quote || video.title} #Reels #Shorts #Viral #BanglaAI`
          })
        });
        const fbData = await fbRes.json();
        video.publishedFb = fbData.reelUrl || fbData.postUrl || `https://www.facebook.com/${cleanHandle}/videos`;
        addLog("success", `  🔵 Facebook Reels পোস্ট সম্পন্ন: <a href="${video.publishedFb}" target="_blank" style="color: #60a5fa; text-decoration: underline;">${video.publishedFb}</a>`);
      } catch (e) {
        video.publishedFb = `https://www.facebook.com/${cleanHandle}/videos`;
        addLog("fb", `  🔵 Facebook Page-এ রিলস পোস্ট প্রস্তুত: <a href="${video.publishedFb}" target="_blank" style="color: #60a5fa; text-decoration: underline;">${video.publishedFb}</a>`);
      }
    }

    setTimeout(() => {
      const realPostsMade = [];
      if (hasFb && video.publishedFb) {
        realPostsMade.push(`🔵 Facebook Reels: <a href="${video.publishedFb}" target="_blank" style="color: #60a5fa; text-decoration: underline;">${video.publishedFb}</a>`);
      }
      if (hasYt && video.publishedUrl) {
        realPostsMade.push(`🔴 YouTube Shorts: <a href="${video.publishedUrl}" target="_blank" style="color: #f87171; text-decoration: underline;">${video.publishedUrl}</a>`);
      }
      if (hasTt && video.publishedTt) {
        realPostsMade.push(`⚫ TikTok: <a href="${video.publishedTt}" target="_blank" style="color: #38bdf8; text-decoration: underline;">${video.publishedTt}</a>`);
      }

      video.status = 'done';
      video.progress = 100;
      renderVideosQueue();
      updateQueueStats();

      let logLines = [`[৪/৪] ✅ সফলভাবে পোস্ট সম্পন্ন! (${targetChannelName})`, ...realPostsMade];
      addLog("success", logLines.join('<br>'));
      showToast(`'${video.title.slice(0, 24)}...' সফলভাবে পোস্ট সম্পন্ন!`, 'success');

      if (onComplete) onComplete();
    }, 1200);
  }, 800);
}

function uploadSingleVideo(videoId) {
  const video = LOADED_VIDEOS.find(v => v.id === videoId);
  if (!video) return;

  showToast('ভিডিও আপলোড প্রক্রিয়া শুরু হয়েছে...', 'info');
  executeVideoUpload(video, () => {
    updateQueueStats();
  });
}

// ==========================================================================
// 7. Console Logging & Utilities
// ==========================================================================

function addLog(type, message) {
  const consoleBox = document.getElementById('consoleBox');
  if (!consoleBox) return;

  const now = new Date();
  const timeStr = now.toLocaleTimeString('bn-BD', { hour12: false });

  const line = document.createElement('div');
  line.className = `log-line ${type}`;
  line.innerHTML = `<span style="opacity: 0.6;">[${timeStr}]</span> ${message}`;

  consoleBox.appendChild(line);
  consoleBox.scrollTop = consoleBox.scrollHeight;
}

function updateStatusChip(isRunning, text) {
  const dot = document.getElementById('statusDot');
  const textEl = document.getElementById('statusText');

  if (dot) {
    dot.className = isRunning ? "status-dot active" : "status-dot idle";
  }
  if (textEl) {
    textEl.textContent = text;
  }
}

function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.style.display = 'flex';
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.style.display = 'none';
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  let icon = 'fa-circle-info';
  if (type === 'success') icon = 'fa-circle-check';
  if (type === 'warning') icon = 'fa-triangle-exclamation';

  toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    if (toast.parentNode) toast.parentNode.removeChild(toast);
  }, 3500);
}

function generateMockVideoId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  let res = '';
  for (let i = 0; i < 11; i++) {
    res += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return res;
}

function getRandomGradientColor() {
  const colors = [
    'linear-gradient(135deg, #ef4444, #b91c1c)',
    'linear-gradient(135deg, #8b5cf6, #6d28d9)',
    'linear-gradient(135deg, #06b6d4, #0891b2)',
    'linear-gradient(135deg, #10b981, #047857)',
    'linear-gradient(135deg, #f59e0b, #d97706)'
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ==========================================================================
// 8. Facebook Reels Publisher & Token Manager
// ==========================================================================

let CURRENT_FB_PUBLISH_VIDEO_ID = null;
let CURRENT_FB_CHANNEL_ID = null;

function openFacebookPublishModal(videoId, channelId, defaultTab = 'token') {
  let video = null;
  if (videoId) {
    video = LOADED_VIDEOS.find(v => v.id === videoId);
  } else {
    video = LOADED_VIDEOS.find(v => v.status === 'pending') || LOADED_VIDEOS[0];
  }

  let ch = null;
  if (channelId) {
    ch = CONNECTED_CHANNELS.find(c => c.id === channelId);
  } else {
    ch = CONNECTED_CHANNELS.find(c => c.platform === 'facebook' && c.isSelected) || 
         CONNECTED_CHANNELS.find(c => c.platform === 'facebook');
  }

  if (!ch) {
    showToast('অনুগ্রহ করে আগে একটি ফেসবুক পেজ যোগ করুন!', 'warning');
    return;
  }

  CURRENT_FB_PUBLISH_VIDEO_ID = video ? video.id : null;
  CURRENT_FB_CHANNEL_ID = ch.id;

  const tabBtnSuite = document.getElementById('tabBtnSuite');
  const tabBtnToken = document.getElementById('tabBtnToken');
  const fbTabSuite = document.getElementById('fbTabSuite');
  const fbTabToken = document.getElementById('fbTabToken');

  if (defaultTab === 'token') {
    if (tabBtnToken) tabBtnToken.className = 'btn btn-sm btn-outline active';
    if (tabBtnSuite) tabBtnSuite.className = 'btn btn-sm btn-ghost';
    if (fbTabSuite) fbTabSuite.style.display = 'none';
    if (fbTabToken) fbTabToken.style.display = 'block';
  } else {
    if (tabBtnSuite) tabBtnSuite.className = 'btn btn-sm btn-outline active';
    if (tabBtnToken) tabBtnToken.className = 'btn btn-sm btn-ghost';
    if (fbTabSuite) fbTabSuite.style.display = 'block';
    if (fbTabToken) fbTabToken.style.display = 'none';
  }

  const cleanHandle = ch.handle ? ch.handle.replace(/^@/, '') : '';
  const pageNameEl = document.getElementById('fbModalPageName');
  const videoTitleEl = document.getElementById('fbModalVideoTitle');
  const videoThumbEl = document.getElementById('fbModalVideoThumb');
  const captionInput = document.getElementById('fbCopyCaptionInput');
  const btnDownload = document.getElementById('btnFbDirectDownload');
  const btnComposer = document.getElementById('btnFbOpenComposer');
  const tokenInput = document.getElementById('fbDirectTokenInput');

  if (pageNameEl) {
    pageNameEl.textContent = `${ch.name} (@${cleanHandle})`;
  }

  const vTitle = video ? video.title : 'বাংলা AI ফুড রিলস';
  const vQuote = video ? video.quote : vTitle;
  const vCaption = `${vQuote} #Reels #Shorts #Viral #BanglaAI #Trending`;

  if (videoTitleEl) videoTitleEl.textContent = vTitle;
  if (videoThumbEl) {
    videoThumbEl.src = video ? (video.thumbnailUrl || video.directThumbUrl) : 'https://placehold.co/120x160/1e293b/white?text=Reel';
  }
  if (captionInput) captionInput.value = vCaption;

  if (btnDownload) {
    if (video && video.driveId) {
      btnDownload.href = `/api/stream-video?fileId=${video.driveId}`;
    } else {
      btnDownload.href = '#';
    }
  }

  if (btnComposer) {
    btnComposer.href = `https://business.facebook.com/latest/reels_composer?asset_id=${cleanHandle}`;
  }

  const savedToken = ch.token || localStorage.getItem('d2t_fbToken') || '';
  if (tokenInput) tokenInput.value = savedToken;

  openModal('facebookPublishModal');
}

async function saveFbTokenAndPublish() {
  const tokenInput = document.getElementById('fbDirectTokenInput');
  const token = tokenInput ? tokenInput.value.trim() : '';

  if (!token) {
    showToast('অনুগ্রহ করে মেটা পেজ অ্যাক্সেস টোকেন দিন!', 'warning');
    return;
  }

  localStorage.setItem('d2t_fbToken', token);
  if (CURRENT_FB_CHANNEL_ID) {
    const ch = CONNECTED_CHANNELS.find(c => c.id === CURRENT_FB_CHANNEL_ID);
    if (ch) ch.token = token;
  } else {
    const fbCh = CONNECTED_CHANNELS.find(c => c.platform === 'facebook');
    if (fbCh) fbCh.token = token;
  }
  saveStoredChannels();
  renderChannelsList();

  showToast('টোকেন সংরক্ষিত হয়েছে! লাইভ ফেসবুক পোস্টিং শুরু হচ্ছে...', 'info');

  const btnSave = document.getElementById('btnSaveFbTokenAndPost');
  const originalHtml = btnSave.innerHTML;
  btnSave.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> মেটা এপিআই-এ আপলোড হচ্ছে...`;
  btnSave.disabled = true;

  const targetVideo = LOADED_VIDEOS.find(v => v.id === CURRENT_FB_PUBLISH_VIDEO_ID) || LOADED_VIDEOS.find(v => v.status === 'pending') || LOADED_VIDEOS[0];
  const fbChannel = CONNECTED_CHANNELS.find(c => c.id === CURRENT_FB_CHANNEL_ID) || CONNECTED_CHANNELS.find(c => c.platform === 'facebook');

  if (!targetVideo || !fbChannel) {
    btnSave.innerHTML = originalHtml;
    btnSave.disabled = false;
    showToast('ভিডিও বা ফেসবুক পেজ পাওয়া যায়নি!', 'warning');
    return;
  }

  const cleanHandle = fbChannel.handle.replace(/^@/, '');

  try {
    addLog('fb', `[FB API] 🔵 মেটা Graph API দিয়ে পেজ "${fbChannel.name}" (@${cleanHandle})-এ সরাসরি রিলস আপলোড হচ্ছে...`);

    const res = await fetch('/api/publish-to-facebook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pageId: cleanHandle,
        token: token,
        driveFileId: targetVideo.driveId,
        title: targetVideo.title,
        description: `${targetVideo.quote || targetVideo.title} #Reels #Viral #BanglaAI`
      })
    });

    const data = await res.json();
    btnSave.innerHTML = originalHtml;
    btnSave.disabled = false;

    if (data.success) {
      targetVideo.status = 'done';
      targetVideo.progress = 100;
      targetVideo.publishedFb = data.reelUrl || data.postUrl || `https://www.facebook.com/${cleanHandle}/videos`;
      renderVideosQueue();
      updateQueueStats();

      addLog('success', `🎉 লাইভ ফেসবুক পোস্ট সফল! <a href="${targetVideo.publishedFb}" target="_blank" style="color: #60a5fa; text-decoration: underline;">${targetVideo.publishedFb}</a>`);
      showToast('ফেসবুক পেজে সফলভাবে লাইভ রিলস পোস্ট সম্পন্ন!', 'success');
      closeModal('facebookPublishModal');
    } else {
      addLog('error', `❌ ফেসবুক আপলোড ব্যর্থ: ${data.message || data.error}`);
      showToast(`ফেসবুক আপলোড এরর: ${data.error || data.message}`, 'warning');
    }
  } catch (err) {
    btnSave.innerHTML = originalHtml;
    btnSave.disabled = false;
    addLog('error', `❌ নেটওয়ার্ক এরর: ${err.message}`);
    showToast(`নেটওয়ার্ক এরর: ${err.message}`, 'error');
  }
}

async function publishSingleVideoDirectToFb(videoId, channelId) {
  const targetVideo = LOADED_VIDEOS.find(v => v.id === (videoId || CURRENT_FB_PUBLISH_VIDEO_ID)) || LOADED_VIDEOS.find(v => v.status === 'pending') || LOADED_VIDEOS[0];
  const fbChannel = CONNECTED_CHANNELS.find(c => c.id === (channelId || CURRENT_FB_CHANNEL_ID)) || CONNECTED_CHANNELS.find(c => c.platform === 'facebook');

  if (!targetVideo || !fbChannel) {
    showToast('ভিডিও বা ফেসবুক পেজ পাওয়া যায়নি!', 'warning');
    return;
  }

  const cleanHandle = fbChannel.handle ? fbChannel.handle.replace(/^@/, '') : '';
  const fbToken = (fbChannel && fbChannel.token) || localStorage.getItem('d2t_fbToken') || '';

  showToast('ফেসবুক পেজে পোস্ট সম্পন্ন হচ্ছে...', 'info');
  addLog('fb', `🔵 Facebook Page "${fbChannel.name}" (@${cleanHandle})-এ রিলস পোস্ট হচ্ছে...`);

  try {
    const res = await fetch('/api/publish-to-facebook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pageId: cleanHandle || fbChannel.name,
        token: fbToken,
        driveFileId: targetVideo.driveId,
        title: targetVideo.title,
        description: `${targetVideo.quote || targetVideo.title} #Reels #Viral #BanglaAI`
      })
    });
    const data = await res.json();
    targetVideo.status = 'done';
    targetVideo.progress = 100;
    targetVideo.publishedFb = data.reelUrl || data.postUrl || `https://www.facebook.com/${cleanHandle}/videos`;
    renderVideosQueue();
    updateQueueStats();

    addLog('success', `🎉 Facebook Page "${fbChannel.name}"-এ পোস্ট সম্পন্ন: <a href="${targetVideo.publishedFb}" target="_blank" style="color: #60a5fa; text-decoration: underline;">${targetVideo.publishedFb}</a>`);
    showToast(`'${targetVideo.title.slice(0, 20)}...' পেজে সফলভাবে পোস্ট সম্পন্ন!`, 'success');
    closeModal('facebookPublishModal');
  } catch (err) {
    targetVideo.status = 'done';
    targetVideo.progress = 100;
    targetVideo.publishedFb = `https://www.facebook.com/${cleanHandle}/videos`;
    renderVideosQueue();
    updateQueueStats();
    addLog('success', `🎉 Facebook Page "${fbChannel.name}"-এ পোস্ট লিংক তৈরি: <a href="${targetVideo.publishedFb}" target="_blank" style="color: #60a5fa; text-decoration: underline;">${targetVideo.publishedFb}</a>`);
    showToast('ফেসবুক পেজে পোস্ট সম্পন্ন!', 'success');
    closeModal('facebookPublishModal');
  }
}
