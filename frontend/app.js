// 全局变量声明
let form;
let resultBox;
let thoughtBox;
let submitBtn;
let cancelBtn;
let clearFilesBtn;
let fileInput;
let modelSelect;
let authStatus;
let authTabsContainer;
let authTabs;
let loginForm;
let registerForm;
let logoutBtn;
let historyList;
let refreshHistoryBtn;
let lockedHint;
let protectedSections;
let copyBtn;
let downloadBtn;
let thoughtCopyBtn;
let thoughtDownloadBtn;
let historyMessagesContainer;
let historyMessagesSection;
let resultSection;
let thoughtSection;

let currentResult = '';
let currentThought = '';

const API_BASE = 'http://localhost:4000';
const QUERY_URL = `${API_BASE}/api/query`;
const MODELS_URL = `${API_BASE}/api/models`;
const HISTORY_URL = `${API_BASE}/api/history`;
const AUTH_REGISTER_URL = `${API_BASE}/api/auth/register`;
const AUTH_LOGIN_URL = `${API_BASE}/api/auth/login`;

let activeController = null;
let lastSelectedFiles = [];
let isUserScrolledUp = false; // 跟踪用户是否手动向上滚动
const state = {
  token: localStorage.getItem('ollama_token') || '',
  user: JSON.parse(localStorage.getItem('ollama_user') || 'null'),
  models: []
};
let currentAuthMode = 'login';

// DOM加载完成后执行初始化
document.addEventListener('DOMContentLoaded', () => {
  // 获取DOM元素
  form = document.getElementById('query-form');
  resultBox = document.getElementById('result-box');
  thoughtBox = document.getElementById('thought-box');
  submitBtn = form.querySelector('button[type="submit"]');
  cancelBtn = document.getElementById('cancel-btn');
  clearFilesBtn = document.getElementById('clear-files-btn');
  fileInput = document.getElementById('file-input');
  modelSelect = document.getElementById('model-select');
  authStatus = document.getElementById('auth-status');
  authTabsContainer = document.getElementById('auth-tabs');
  authTabs = document.querySelectorAll('.auth-tab');
  loginForm = document.getElementById('login-form');
  registerForm = document.getElementById('register-form');
  logoutBtn = document.getElementById('logout-btn');
  historyList = document.getElementById('history-list');
  refreshHistoryBtn = document.getElementById('refresh-history-btn');
  lockedHint = document.getElementById('locked-hint');
  protectedSections = document.querySelectorAll('.requires-auth');
  copyBtn = document.getElementById('current-copy-btn');
  downloadBtn = document.getElementById('current-download-btn');
  thoughtCopyBtn = document.getElementById('current-thought-copy-btn');
  thoughtDownloadBtn = document.getElementById('current-thought-download-btn');
  historyMessagesContainer = document.getElementById('history-messages-container');
  historyMessagesSection = document.querySelector('.history-messages');
  resultSection = document.querySelector('.result');
  thoughtSection = document.querySelector('.result');
  
  // 绑定事件监听器
  bindEventListeners();
  
  // 初始化应用
  initializeApp();
});

// 绑定所有事件监听器
function bindEventListeners() {
  // 文件输入事件
  fileInput.addEventListener('change', () => {
    const currentFiles = Array.from(fileInput.files || []);
    if (currentFiles.length === 0 && lastSelectedFiles.length > 0) {
      restoreFilesFromCache();
      return;
    }
    lastSelectedFiles = currentFiles;
  });
  
  // 表单提交事件
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!state.token) {
      // 显示错误信息
      const currentQueryElement = document.getElementById('current-query');
      const queryContent = document.getElementById('current-query-content');
      const currentResultElement = document.getElementById('current-result');
      const currentThoughtElement = document.getElementById('current-thought');
      
      queryContent.innerHTML = '请先登录后再提问';
      currentQueryElement.classList.remove('hidden');
      currentResultElement.classList.add('hidden');
      currentThoughtElement.classList.add('hidden');
      return;
    }

    const data = new FormData(form);
    const prompt = data.get('prompt');

    if (!prompt || prompt.trim().length === 0) {
      // 显示错误信息
      const currentQueryElement = document.getElementById('current-query');
      const queryContent = document.getElementById('current-query-content');
      const currentResultElement = document.getElementById('current-result');
      const currentThoughtElement = document.getElementById('current-thought');
      
      queryContent.innerHTML = '请输入提示词';
      currentQueryElement.classList.remove('hidden');
      currentResultElement.classList.add('hidden');
      currentThoughtElement.classList.add('hidden');
      return;
    }

    if (activeController) {
      activeController.abort();
    }
    const controller = new AbortController();
    activeController = controller;

    // 重置结果和思考过程
    currentResult = '';
    currentThought = '';
    
    // 确保历史消息区域（父容器）可见
    console.log('历史消息区域隐藏状态:', historyMessagesSection.classList.contains('hidden'));
    historyMessagesSection.classList.remove('hidden');
    console.log('历史消息区域隐藏状态（移除后）:', historyMessagesSection.classList.contains('hidden'));
    
    // 创建一个新的消息元素，与历史消息卡片结构一致
    const newMessageElement = document.createElement('div');
    newMessageElement.className = 'history-message';
    newMessageElement.id = 'new-message';
    
    // 显示当前提问
    const now = new Date().toLocaleString();
    newMessageElement.innerHTML = `
      <div class="message-divider">${now}</div>
      <div class="message-title">${prompt.length > 50 ? prompt.slice(0, 50) + '...' : prompt}</div>
      <div class="message-content">
        <div class="message-prompt">${marked.parse(prompt)}</div>
        <div class="message-thought" id="current-thought-box"><span style="color: #94a3b8; font-style: italic;">等待模型思考...</span></div>
        <div class="message-result" id="current-result-box"><span style="color: #94a3b8; font-style: italic;">等待 Ollama 最终回答...</span></div>
      </div>
    `;
    
    // 将新消息添加到历史消息容器的底部
    historyMessagesContainer.appendChild(newMessageElement);
    
    // 获取新创建的元素引用
    const thoughtBox = newMessageElement.querySelector('.message-thought');
    const resultBox = newMessageElement.querySelector('.message-result');
    
    // 更新全局引用，确保consumeEventStream使用正确的元素
    window.currentThoughtBox = thoughtBox;
    window.currentResultBox = resultBox;
    
    console.log('=== 创建新消息卡片 ===');
    console.log('newMessageElement:', newMessageElement);
    console.log('thoughtBox:', thoughtBox);
    console.log('resultBox:', resultBox);
    
    // 自动滚动到最新内容
    const contentScroll = document.querySelector('.content-scroll');
    contentScroll.scrollTop = contentScroll.scrollHeight;
    isUserScrolledUp = false; // 重置用户滚动状态，确保新消息默认自动滚动
    
    // 重新绑定复制和下载按钮的事件监听器
    bindCopyDownloadEventListeners();
    
    setLoading(true);

    // 立刻清空文本框和附件
    document.querySelector('#query-form textarea[name="prompt"]').value = '';
    fileInput.value = '';
    lastSelectedFiles = [];
    
    try {
      const response = await fetch(`${QUERY_URL}?stream=true`, {
        method: 'POST',
        headers: {
          Accept: 'text/event-stream',
          Authorization: `Bearer ${state.token}`
        },
        body: data,
        signal: controller.signal
      });

      if (response.status === 401) {
        clearSession();
        throw new Error('登录状态失效，请重新登录');
      }

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || '服务端错误');
      }

      const contentType = response.headers.get('content-type') || '';

      if (contentType.includes('text/event-stream')) {
        await consumeEventStream(response);
      } else {
        const payload = await response.json();
        // 更新思考过程
        if (payload.thinking) {
          currentThought = payload.thinking;
          // 优先使用全局引用的元素，避免ID冲突
          const thoughtBox = window.currentThoughtBox || document.getElementById('current-thought-box');
          if (thoughtBox) {
            thoughtBox.innerHTML = marked.parse(payload.thinking);
          }
        }
        // 更新结果
        currentResult = payload.result || '无内容返回';
        // 优先使用全局引用的元素，避免ID冲突
        const resultBox = window.currentResultBox || document.getElementById('current-result-box');
        if (resultBox) {
          resultBox.innerHTML = marked.parse(currentResult);
        }
      }

      fetchHistory();
    } catch (err) {
      currentResult = '';
      currentThought = '';
      // 优先使用全局引用的元素，避免ID冲突
      const thoughtBox = window.currentThoughtBox || document.getElementById('current-thought-box');
      const resultBox = window.currentResultBox || document.getElementById('current-result-box');
      
      if (err.name === 'AbortError') {
        if (thoughtBox) thoughtBox.innerHTML = '请求已取消';
        if (resultBox) resultBox.innerHTML = '请求已取消';
      } else {
        if (thoughtBox) thoughtBox.innerHTML = `请求失败：${err.message}`;
        if (resultBox) resultBox.innerHTML = `请求失败：${err.message}`;
      }
    } finally {
      setLoading(false);
      activeController = null;
      // 不再清空文本框和附件，因为已经在发送前清空了
    }
  });
  
  // 取消/清空消息按钮事件
  cancelBtn.addEventListener('click', () => {
    if (activeController) {
      activeController.abort();
    }
    
    // 清空提示词输入框
    document.querySelector('#query-form textarea[name="prompt"]').value = '';
    
    // 清空附件
    fileInput.value = '';
    lastSelectedFiles = [];
    
    // 恢复按钮状态为非加载状态
    setLoading(false);
    
    // 保留当前思考过程和结果，不进行重置
    // 这样已经获取的流式信息会保留在界面上
    
    // 显示请求被取消的提示
    const resultBox = window.currentResultBox || document.getElementById('current-result-box');
    if (resultBox) {
      // 检查是否已有内容，如果有，则添加取消提示
      if (currentResult) {
        resultBox.innerHTML = marked.parse(currentResult + '\n\n<small style="color: #ef4444;">（请求已被取消）</small>');
      }
    }
    
    const thoughtBox = window.currentThoughtBox || document.getElementById('current-thought-box');
    if (thoughtBox && !currentThought) {
      // 如果思考过程为空，则显示默认提示
      thoughtBox.innerHTML = '<span style="color: #94a3b8; font-style: italic;">等待模型思考...</span>';
    }
  });
  
  // 中止查询按钮事件
  const abortBtn = document.querySelector('#abort-btn');
  if (abortBtn) {
    abortBtn.addEventListener('click', () => {
      if (activeController) {
        activeController.abort();
        
        // 恢复按钮状态为非加载状态
        setLoading(false);
        
        // 显示请求被取消的提示
        const resultBox = window.currentResultBox || document.getElementById('current-result-box');
        if (resultBox) {
          // 检查是否已有内容，如果有，则添加取消提示
          if (currentResult) {
            resultBox.innerHTML = marked.parse(currentResult + '\n\n<small style="color: #ef4444;">（请求已被取消）</small>');
          }
        }
        
        const thoughtBox = window.currentThoughtBox || document.getElementById('current-thought-box');
        if (thoughtBox && !currentThought) {
          // 如果思考过程为空，则显示默认提示
          thoughtBox.innerHTML = '<span style="color: #94a3b8; font-style: italic;">等待模型思考...</span>';
        }
      }
    });
  }
  
  // 清除附件按钮事件
  clearFilesBtn.addEventListener('click', () => {
    fileInput.value = '';
    lastSelectedFiles = [];
    resultBox.textContent = '已清除附件，仅保留当前提示词';
    thoughtBox.textContent = '附件已清除';
  });
  
  // 认证标签切换事件
  authTabs.forEach(tab => {
    tab.addEventListener('click', () => setAuthMode(tab.dataset.mode));
  });
  
  // 登录表单提交事件
  loginForm.addEventListener('submit', event => {
    event.preventDefault();
    handleAuth('login', new FormData(loginForm));
  });
  
  // 注册表单提交事件
  registerForm.addEventListener('submit', event => {
    event.preventDefault();
    handleAuth('register', new FormData(registerForm));
  });
  
  // 登出按钮事件
  logoutBtn.addEventListener('click', () => {
    clearSession();
    updateAuthUI('已退出登录');
    historyList.innerHTML = '<li>已退出</li>';
  });
  
  // 刷新历史记录按钮事件
  refreshHistoryBtn.addEventListener('click', () => fetchHistory());
  
  // 绑定复制和下载按钮事件
  bindCopyDownloadEventListeners();
};

// 初始化应用
function initializeApp() {
  setAuthMode('login');
  updateAuthUI();
  fetchModels();
  fetchHistory();
}

function setLoading(loading) {
  submitBtn.disabled = loading;
  // 保持发送按钮文本不变，只禁用
  // submitBtn.textContent = loading ? '发送中...' : '发送';
  cancelBtn.disabled = !loading;
  clearFilesBtn.disabled = loading;
  
  // 控制中止查询按钮的显示/隐藏
  const abortBtn = document.querySelector('#abort-btn');
  if (abortBtn) {
    abortBtn.classList.toggle('hidden', !loading);
  }
}

function restoreFilesFromCache() {
  if (lastSelectedFiles.length === 0) return;
  const transfer = new DataTransfer();
  lastSelectedFiles.forEach(file => transfer.items.add(file));
  fileInput.files = transfer.files;
}

function saveSession(token, user) {
  state.token = token;
  state.user = user;
  localStorage.setItem('ollama_token', token);
  localStorage.setItem('ollama_user', JSON.stringify(user));
  updateAuthUI();
}

function clearSession() {
  state.token = '';
  state.user = null;
  localStorage.removeItem('ollama_token');
  localStorage.removeItem('ollama_user');
  updateAuthUI();
}

function updateAuthUI(message) {
  if (state.user) {
    // 从邮箱中提取用户名（@符号前的部分）
    const username = state.user.email.split('@')[0];
    authStatus.textContent = message || `欢迎，${username}`;
    logoutBtn.disabled = false;
    logoutBtn.classList.remove('hidden');
  } else {
    authStatus.textContent = message || '未登录';
    logoutBtn.disabled = true;
    logoutBtn.classList.add('hidden');
  }

  authTabsContainer.classList.toggle('hidden', Boolean(state.user));
  if (state.user) {
    loginForm.classList.add('hidden');
    registerForm.classList.add('hidden');
  } else {
    setAuthMode(currentAuthMode);
  }
  toggleProtectedSections();
}

function toggleProtectedSections() {
  const isAuthed = Boolean(state.user);
  protectedSections.forEach(section => {
    section.classList.toggle('hidden', !isAuthed);
  });
  lockedHint.classList.toggle('hidden', isAuthed);
  
  // 切换左侧边栏显示状态
  const sidebar = document.querySelector('.sidebar');
  const mainContainer = document.querySelector('.main-container');
  const authPanel = document.querySelector('#auth-panel');
  const contentScroll = document.querySelector('.content-scroll');
  
  if (isAuthed) {
    // 登录状态：显示侧边栏，将登录面板放回侧边栏
    sidebar.classList.remove('hidden');
    mainContainer.classList.remove('no-sidebar');
    authPanel.classList.remove('auth-panel-center');
    
    // 如果登录面板不在侧边栏中，则将其放回
    if (authPanel.parentElement !== document.querySelector('.sidebar-content')) {
      document.querySelector('.sidebar-content').insertBefore(authPanel, document.querySelector('.history'));
    }
  } else {
    // 未登录状态：隐藏侧边栏，将登录面板移到主内容区域
    sidebar.classList.add('hidden');
    mainContainer.classList.add('no-sidebar');
    authPanel.classList.add('auth-panel-center');
    
    // 将登录面板移到主内容区域的locked-hint下方
    if (authPanel.parentElement !== contentScroll) {
      contentScroll.insertBefore(authPanel, document.querySelector('.history-messages'));
    }
  }
}

function setAuthMode(mode) {
  currentAuthMode = mode;
  authTabs.forEach(tab => {
    tab.classList.toggle('active', tab.dataset.mode === mode);
  });

  if (!state.user) {
    loginForm.classList.toggle('hidden', mode !== 'login');
    registerForm.classList.toggle('hidden', mode !== 'register');
  }
}

async function fetchModels() {
  try {
    const res = await fetch(MODELS_URL);
    if (!res.ok) throw new Error('加载模型失败');
    const data = await res.json();
    state.models = data.models || [];
    modelSelect.innerHTML = '';
    state.models.forEach(name => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      if (name === data.defaultModel) {
        option.selected = true;
      }
      modelSelect.appendChild(option);
    });
  } catch (err) {
    console.warn(err);
  }
}

async function fetchHistory() {
  if (!state.token) {
    historyList.innerHTML = '<li>请登录后查看历史</li>';
    return;
  }
  console.log('fetchHistory', state.token, state.user);
  try {
    const res = await fetch(HISTORY_URL, {
      headers: {
        Authorization: `Bearer ${state.token}`,
      },
    });
    if (res.status === 401) {
      // 尝试从localStorage重新获取token，避免热启动时的状态重置
      const storedToken = localStorage.getItem('ollama_token');
      const storedUser = JSON.parse(localStorage.getItem('ollama_user') || 'null');
      
      if (storedToken && storedUser) {
        // 如果localStorage中存在token和user，重新保存会话并再次尝试
        saveSession(storedToken, storedUser);
        try {
          // 重试一次获取历史
          const retryRes = await fetch(HISTORY_URL, {
            headers: {
              Authorization: `Bearer ${storedToken}`,
            },
          });
          if (retryRes.status === 401) {
            // 重试仍然失败，才清除会话
            clearSession();
            historyList.innerHTML = '<li>登录过期，请重新登录</li>';
            return;
          } else if (retryRes.ok) {
            const data = await retryRes.json();
            historyMessagesSection.classList.remove('hidden');
            renderHistory(data.history || []);
            return;
          }
        } catch (retryErr) {
          console.warn('重试获取历史失败:', retryErr);
        }
      } else {
        // localStorage中也没有token和user，清除会话
        clearSession();
        historyList.innerHTML = '<li>登录过期，请重新登录</li>';
        return;
      }
    }
    if (!res.ok) {
      throw new Error('获取历史失败');
    }
    const data = await res.json();
    
    // 显示历史消息区域
    historyMessagesSection.classList.remove('hidden');
    renderHistory(data.history || []);
  } catch (err) {
    console.warn(err);
    // 网络错误时不清除登录状态，只显示错误信息
    historyList.innerHTML = `<li>获取历史失败: ${err.message}</li>`;
  }
}

function renderHistory(items) {
  // 侧边栏历史记录保持不变
  if (!items.length) {
    historyList.innerHTML = '<li>暂无历史记录</li>';
    historyMessagesContainer.innerHTML = '<p>暂无历史消息记录</p>';
    return;
  }
  historyList.innerHTML = '';
  
  // 将历史消息按日期时间从近到远排序
  const sortedItems = [...items].sort((a, b) => {
    const dateA = a.createdAt ? new Date(a.createdAt) : new Date(0);
    const dateB = b.createdAt ? new Date(b.createdAt) : new Date(0);
    return dateB - dateA;
  });
  
  // 渲染侧边栏历史记录
  sortedItems.forEach((item, index) => {
    const li = document.createElement('li');
    const date = item.createdAt ? new Date(item.createdAt).toLocaleString() : '';
    // 只展示结果的前50个字
    const resultPreview = 
      item.result && item.result.length > 50 ? `${item.result.slice(0, 50)}…` : item.result || '(空)';
      
    li.innerHTML = `
      <h3>${item.model} · ${date}</h3>
      <p><strong>提示词:</strong> ${item.prompt || '(空)'}</p>
      <p><strong>结果:</strong> ${resultPreview}</p>
    `;
    
    // 添加点击事件，滚动到对应记录
    li.addEventListener('click', () => {
      // 由于右侧主体区域消息顺序反转，需要计算正确的索引
      const reversedIndex = sortedItems.length - 1 - index;
      const targetMessage = document.getElementById(`history-message-${reversedIndex}`);
      if (targetMessage) {
        const contentScroll = document.querySelector('.content-scroll');
        const targetTop = targetMessage.offsetTop;
        contentScroll.scrollTo({
          top: targetTop - 20, // 20px 偏移量，避免紧贴顶部
          behavior: 'smooth' // 平滑滚动
        });
      }
    });
    
    // 添加悬停样式，提示可点击
    li.style.cursor = 'pointer';
    li.style.transition = 'background-color 0.2s';
    li.addEventListener('mouseenter', () => {
      li.style.backgroundColor = '#f8fafc';
    });
    li.addEventListener('mouseleave', () => {
      li.style.backgroundColor = 'transparent';
    });
    
    historyList.appendChild(li);
  });
  
  // 渲染右侧主体区域的历史消息（保持最新消息在下面）
    historyMessagesContainer.innerHTML = '';
    const reversedSortedItems = [...sortedItems].reverse();
    reversedSortedItems.forEach((item, index) => {
      const messageDiv = document.createElement('div');
      messageDiv.className = 'history-message';
      messageDiv.id = `history-message-${index}`; // 为每条消息添加唯一ID
      
      const date = item.createdAt ? new Date(item.createdAt).toLocaleString() : '';
      
      // 消息标题（使用提示词的前50个字符或默认文本）
      const title = item.prompt && item.prompt.length > 0 
        ? (item.prompt.length > 50 ? item.prompt.slice(0, 50) + '...' : item.prompt) 
        : '(空提示词)';
      
      // 思考过程和结果（支持markdown）
      const thought = item.thinking || '';
      const result = item.result || '';
      
      // 确保思考过程总是显示，即使为空
      const thoughtContent = thought ? marked.parse(thought) : '<span style="color: #94a3b8; font-style: italic;">(无思考过程)</span>';
      
      messageDiv.innerHTML = `
        <div class="message-divider">${date}</div>
        <div class="message-title">${title}</div>
        <div class="message-content">
          <div class="message-thought">${thoughtContent}</div>
          ${result ? `<div class="message-result">${marked.parse(result)}</div>` : '<div class="message-result"><span style="color: #94a3b8; font-style: italic;">(无结果)</span></div>'}
        </div>
      `;
      
      historyMessagesContainer.appendChild(messageDiv);
    });
  
  // 自动滚动到最新的历史记录
  const contentScroll = document.querySelector('.content-scroll');
  contentScroll.scrollTop = contentScroll.scrollHeight;
  
  // 添加悬浮的滚动按钮
  addScrollButtons();
}

// 添加悬浮的滚动按钮（向上和向下）
function addScrollButtons() {
  // 先移除已存在的按钮
  const existingLatestButton = document.getElementById('scroll-to-latest');
  const existingTopButton = document.getElementById('scroll-to-top');
  if (existingLatestButton) existingLatestButton.remove();
  if (existingTopButton) existingTopButton.remove();
  
  const contentScroll = document.querySelector('.content-scroll');
  
  // 创建向下滚动到最新消息的按钮
  const downButton = document.createElement('button');
  downButton.id = 'scroll-to-latest';
  downButton.innerHTML = '↓';
  downButton.title = '滚动到最新消息';
  
  // 创建向上滚动到顶部的按钮
  const upButton = document.createElement('button');
  upButton.id = 'scroll-to-top';
  upButton.innerHTML = '↑';
  upButton.title = '滚动到顶部';
  
  // 通用按钮样式
  const buttonStyle = `
    position: fixed;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background-color: #3b82f6;
    color: white;
    border: none;
    font-size: 20px;
    cursor: pointer;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
    transition: opacity 0.3s, transform 0.3s;
    opacity: 0;
    visibility: hidden;
    z-index: 1000;
  `;
  
  // 设置按钮位置
  downButton.style.cssText = buttonStyle + `
    bottom: 20px;
    right: 20px;
  `;
  
  upButton.style.cssText = buttonStyle + `
    bottom: 70px;
    right: 20px;
  `;
  
  // 滚动事件监听，控制按钮显示/隐藏和用户滚动状态
  contentScroll.addEventListener('scroll', () => {
    // 向下按钮：只有在页面未滚动到最底部时显示
    const isScrolledUp = contentScroll.scrollTop < contentScroll.scrollHeight - contentScroll.clientHeight;
    if (isScrolledUp) {
      downButton.style.opacity = '1';
      downButton.style.visibility = 'visible';
      // 用户手动向上滚动了
      isUserScrolledUp = true;
    } else {
      downButton.style.opacity = '0';
      downButton.style.visibility = 'hidden';
      // 滚动到最底部时，重置用户滚动状态
      isUserScrolledUp = false;
    }
    
    // 向上按钮：只有在页面滚动超过一定距离时显示
    const isScrolledDown = contentScroll.scrollTop > 100;
    if (isScrolledDown) {
      upButton.style.opacity = '1';
      upButton.style.visibility = 'visible';
    } else {
      upButton.style.opacity = '0';
      upButton.style.visibility = 'hidden';
    }
  });
  
  // 向下按钮点击事件：滚动到最新消息
  downButton.addEventListener('click', () => {
    contentScroll.scrollTo({
      top: contentScroll.scrollHeight,
      behavior: 'smooth'
    });
  });
  
  // 向上按钮点击事件：滚动到顶部
  upButton.addEventListener('click', () => {
    contentScroll.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  });
  
  // 添加到页面
  document.body.appendChild(downButton);
  document.body.appendChild(upButton);
}

async function handleAuth(action, formData) {
  const email = (formData.get('email') || '').trim();
  const password = formData.get('password') || '';
  if (!email || !password) {
    updateAuthUI('请输入邮箱和密码');
    return;
  }

  if (action === 'register') {
    const confirmPassword = formData.get('confirmPassword') || '';
    if (password.length < 6) {
      updateAuthUI('密码至少6位');
      return;
    }
    if (password !== confirmPassword) {
      updateAuthUI('两次输入的密码不一致');
      return;
    }
  }

  const endpoint = action === 'login' ? AUTH_LOGIN_URL : AUTH_REGISTER_URL;

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || '请求失败');
    }
    saveSession(data.token, data.user);
    updateAuthUI(); // 不传递成功消息，直接显示用户名
    loginForm.reset();
    registerForm.reset();
    setAuthMode('login');
    fetchHistory();
  } catch (err) {
    updateAuthUI(err.message);
  }
}

async function consumeEventStream(response) {
  console.log('=== 开始处理事件流 ===');
  console.log('response:', response);
  console.log('response.body:', response.body);
  
  if (!response.body) {
    throw new Error('浏览器不支持可读流');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalText = '';
  let thinkingText = '';

  // 优先使用全局引用的元素，避免ID冲突
  const thoughtBox = window.currentThoughtBox || document.getElementById('current-thought-box');
  const resultBox = window.currentResultBox || document.getElementById('current-result-box');
  const contentScroll = document.querySelector('.content-scroll');
  
  console.log('consumeEventStream - thoughtBox:', thoughtBox);
  console.log('consumeEventStream - resultBox:', resultBox);

  while (true) {
    const { done, value } = await reader.read();
    console.log('事件流读取结果:', { done, value: value ? value.length : 0 });
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() || '';
    console.log('解析到的事件数量:', events.length);

    for (const event of events) {
      const lines = event.split('\n');
      const dataLine = lines.find(line => line.startsWith('data:'));
      if (!dataLine) {
        console.log('跳过非data行:', event);
        continue;
      }

      try {
        const payload = JSON.parse(dataLine.slice(5).trim());
        console.log('解析到的payload:', payload);
        if (payload.type === 'chunk') {
            // 更新思考过程
            if (payload.thinking) {
              // 假设服务器返回的是完整的思考过程，而不是增量内容
              thinkingText = payload.thinking;
              currentThought = thinkingText;
              thoughtBox.innerHTML = marked.parse(thinkingText);
              thoughtBox.scrollTop = thoughtBox.scrollHeight;
              console.log('更新思考过程:', payload.thinking);
            }
            
            // 更新结果
            if (payload.text) {
              finalText += payload.text;
              currentResult = finalText;
              resultBox.innerHTML = marked.parse(finalText);
              resultBox.scrollTop = resultBox.scrollHeight;
              console.log('更新结果:', payload.text);
            }
            
            // 只有当用户没有手动向上滚动时，才自动滚动到最新内容
            if (!isUserScrolledUp) {
              contentScroll.scrollTop = contentScroll.scrollHeight;
            }
          } else if (payload.type === 'done') {
            console.log('事件流结束:', payload);
            let resultContent;
            if (payload.total_duration_ms) {
              const seconds = (payload.total_duration_ms / 1000).toFixed(2);
              resultContent = `${finalText}\n\n(总耗时 ${seconds}s)`;
            } else {
              resultContent = finalText || '无内容返回';
            }
            currentResult = resultContent;
            // 添加总耗时信息
            resultBox.innerHTML = marked.parse(resultContent);
            resultBox.scrollTop = resultBox.scrollHeight;
            
            // 只有当用户没有手动向上滚动时，才自动滚动到最新内容
            if (!isUserScrolledUp) {
              contentScroll.scrollTop = contentScroll.scrollHeight;
            }
          }
      } catch (err) {
        console.warn('解析流事件失败', err);
      }
    }
  }
}

// 复制按钮功能 - 暂时移除，因为新消息结构与历史消息一致，不包含这些按钮
function bindCopyDownloadEventListeners() {
  // 新消息结构与历史消息一致，不再包含复制和下载按钮
  // 这些功能将在历史消息中通过其他方式实现
}

