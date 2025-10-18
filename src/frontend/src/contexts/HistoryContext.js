import React, { createContext, useContext, useReducer } from 'react';

const HistoryStateContext = createContext();
const HistoryDispatchContext = createContext();

const initialState = {
  video: {
    history: [],
    totalRows: 0,
    page: 1,
    rowsPerPage: 10,
    filters: {
      start_date: null,
      end_date: null,
      status: '',
      model: '',
      is_edited: false,
      only_success: false,
    },
    searchText: '',
    hasFetched: false,
    cache: {},
  },
  image: {
    history: [],
    totalRows: 0,
    page: 1,
    rowsPerPage: 10,
    filters: {
      start_date: null,
      end_date: null,
      status: '',
      model: '',
      is_edited: false,
      only_success: false,
    },
    searchText: '',
    hasFetched: false,
    cache: {},
  },
  'image-enrichment': {
    history: [],
    totalRows: 0,
    page: 1,
    rowsPerPage: 10,
    filters: {
      start_date: null,
      end_date: null,
      status: '',
      model: '',
      is_edited: false,
      only_success: false,
    },
    searchText: '',
    hasFetched: false,
    cache: {},
  },
};

function historyReducer(state, action) {
  switch (action.type) {
    case 'SET_DATA':
      return {
        ...state,
        [action.payload.tab]: {
          ...state[action.payload.tab],
          history: action.payload.data.rows,
          totalRows: action.payload.data.total,
          page: action.payload.page,
          rowsPerPage: action.payload.rowsPerPage,
          hasFetched: true,
        },
      };
    case 'SET_CACHE':
      return {
        ...state,
        [action.payload.tab]: {
          ...state[action.payload.tab],
          cache: {
            ...state[action.payload.tab].cache,
            [action.payload.cacheKey]: action.payload.data,
          },
        },
      };
    case 'CLEAR_CACHE':
      return {
        ...state,
        [action.payload.tab]: {
          ...state[action.payload.tab],
          cache: {},
          history: [],
          totalRows: 0,
          page: 1,
        },
      };
    case 'SET_FILTERS':
      return {
        ...state,
        [action.payload.tab]: {
          ...state[action.payload.tab],
          filters: action.payload.filters,
        },
      };
    case 'SET_SEARCH_TEXT':
        return {
            ...state,
            [action.payload.tab]: {
                ...state[action.payload.tab],
                searchText: action.payload.searchText,
            },
        };
    case 'SET_PAGE':
        return {
            ...state,
            [action.payload.tab]: {
                ...state[action.payload.tab],
                page: action.payload.page,
                rowsPerPage: action.payload.rowsPerPage,
            },
        };
    default:
      throw new Error(`Unknown action: ${action.type}`);
  }
}

export const HistoryProvider = ({ children }) => {
  const [state, dispatch] = useReducer(historyReducer, initialState);

  return (
    <HistoryStateContext.Provider value={state}>
      <HistoryDispatchContext.Provider value={dispatch}>
        {children}
      </HistoryDispatchContext.Provider>
    </HistoryStateContext.Provider>
  );
};

export const useHistoryState = () => {
  const context = useContext(HistoryStateContext);
  if (context === undefined) {
    throw new Error('useHistoryState must be used within a HistoryProvider');
  }
  return context;
};

export const useHistoryDispatch = () => {
  const context = useContext(HistoryDispatchContext);
  if (context === undefined) {
    throw new Error('useHistoryDispatch must be used within a HistoryProvider');
  }
  return context;
};
