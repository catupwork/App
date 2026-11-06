import {act, renderHook} from '@testing-library/react-native';

import OnyxListItemProvider from '@components/OnyxListItemProvider';

import useFetchMissingTransactionThreadParents from '@hooks/useFetchMissingTransactionThreadParents';

import {openReport} from '@userActions/Report';

import CONST from '@src/CONST';
import ONYXKEYS from '@src/ONYXKEYS';
import type {Report, ReportAction} from '@src/types/onyx';
import type PriorityMode from '@src/types/onyx/PriorityMode';

import type {OnyxCollection} from 'react-native-onyx';

import React from 'react';
import Onyx from 'react-native-onyx';

import {actionR14932 as mockIOUAction} from '../../__mocks__/reportData/actions';
import waitForBatchedUpdatesWithAct from '../utils/waitForBatchedUpdatesWithAct';

jest.mock('@userActions/Report', () => ({
    openReport: jest.fn(),
}));

const CURRENT_USER_ACCOUNT_ID = 5;
const EXPENSE_REPORT_ID = '1';
const THREAD_REPORT_ID = '2';
const PARENT_ACTION_ID = '100';

const expenseReportKey = `${ONYXKEYS.COLLECTION.REPORT}${EXPENSE_REPORT_ID}` as const;
const threadReportKey = `${ONYXKEYS.COLLECTION.REPORT}${THREAD_REPORT_ID}` as const;

// The parent's IOU action, as the server returns it alongside the thread it points to.
const iouAction: ReportAction = {
    ...mockIOUAction,
    reportActionID: PARENT_ACTION_ID,
    reportID: EXPENSE_REPORT_ID,
    childReportID: THREAD_REPORT_ID,
    actorAccountID: CURRENT_USER_ACCOUNT_ID,
    created: '2025-01-20 11:00:00.000',
};

const commentAction: ReportAction = {
    reportActionID: PARENT_ACTION_ID,
    actionName: CONST.REPORT.ACTIONS.TYPE.ADD_COMMENT,
    message: [{type: 'COMMENT', html: 'Hello', text: 'Hello'}],
    childReportID: THREAD_REPORT_ID,
    actorAccountID: 18921695,
    created: '2025-01-20 11:00:00.000',
};

// The transaction thread as a Focus-mode OpenApp returns it after Clear cache and restart: unread, and hidden for the submitter.
const unreadThread: Report = {
    reportID: THREAD_REPORT_ID,
    type: CONST.REPORT.TYPE.CHAT,
    parentReportID: EXPENSE_REPORT_ID,
    parentReportActionID: PARENT_ACTION_ID,
    participants: {[CURRENT_USER_ACCOUNT_ID]: {notificationPreference: CONST.REPORT.NOTIFICATION_PREFERENCE.HIDDEN}},
    lastReadTime: '2025-01-20 12:00:00.000',
    lastVisibleActionCreated: '2025-01-20 13:00:00.000',
    lastActorAccountID: 18921695,
};

const expenseReport: Report = {
    reportID: EXPENSE_REPORT_ID,
    type: CONST.REPORT.TYPE.EXPENSE,
    transactionCount: 1,
    lastReadTime: '2025-01-20 12:00:00.000',
    lastVisibleActionCreated: '2025-01-20 11:00:00.000',
    lastActorAccountID: CURRENT_USER_ACCOUNT_ID,
};

type HookProps = {reportUpdates: OnyxCollection<Report> | undefined; reports: OnyxCollection<Report>; priorityMode: PriorityMode};

function TestWrapper({children}: {children: React.ReactNode}) {
    return <OnyxListItemProvider>{children}</OnyxListItemProvider>;
}

let hookProps: HookProps;

function renderWithReports(reports: OnyxCollection<Report>, priorityMode: PriorityMode = CONST.PRIORITY_MODE.GSD) {
    hookProps = {reportUpdates: reports, reports, priorityMode};
    return renderHook(() => useFetchMissingTransactionThreadParents(hookProps.reportUpdates, hookProps.reports, hookProps.priorityMode), {wrapper: TestWrapper});
}

describe('useFetchMissingTransactionThreadParents', () => {
    beforeAll(() => {
        Onyx.init({keys: ONYXKEYS});
    });

    beforeEach(async () => {
        jest.clearAllMocks();
        await act(async () => {
            await Onyx.clear();
            await Onyx.set(ONYXKEYS.SESSION, {accountID: CURRENT_USER_ACCOUNT_ID, email: 'test@example.com'});
            await Onyx.set(`${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${EXPENSE_REPORT_ID}`, {[PARENT_ACTION_ID]: iouAction});
        });
        await waitForBatchedUpdatesWithAct();
    });

    it('fetches the missing parent of an unread transaction thread once, without marking it read', async () => {
        // Given the Onyx state a Focus-mode OpenApp leaves after Clear cache and restart: the unread transaction thread and the
        // parent's IOU action are present, but the read expense report itself is not
        const {rerender} = renderWithReports({[threadReportKey]: unreadThread});
        await waitForBatchedUpdatesWithAct();

        // Then the expense report is fetched without touching the user's read state
        expect(openReport).toHaveBeenCalledTimes(1);
        expect(openReport).toHaveBeenCalledWith(expect.objectContaining({reportID: EXPENSE_REPORT_ID, shouldMarkAsRead: false}));

        // When the thread changes again before the parent arrives, e.g. another comment lands on it
        const threadWithNewerComment: Report = {...unreadThread, lastVisibleActionCreated: '2025-01-20 14:00:00.000'};
        hookProps = {reportUpdates: {[threadReportKey]: threadWithNewerComment}, reports: {[threadReportKey]: threadWithNewerComment}, priorityMode: CONST.PRIORITY_MODE.GSD};
        rerender(undefined);
        await waitForBatchedUpdatesWithAct();

        // Then the parent is not requested a second time
        expect(openReport).toHaveBeenCalledTimes(1);
    });

    it('does not fetch a parent that is already in Onyx', async () => {
        // Given both the expense report and its unread transaction thread are in Onyx, as in a running app
        renderWithReports({[threadReportKey]: unreadThread, [expenseReportKey]: expenseReport});
        await waitForBatchedUpdatesWithAct();

        // Then there is nothing to fetch, since the existing LHN logic can resolve the thread from the parent's actions
        expect(openReport).not.toHaveBeenCalled();
    });

    it('does not fetch the parent of a comment thread', async () => {
        // Given an unread thread whose parent action is a plain comment, so the LHN can show the thread on its own row
        await act(async () => {
            await Onyx.set(`${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${EXPENSE_REPORT_ID}`, {[PARENT_ACTION_ID]: commentAction});
        });
        renderWithReports({[threadReportKey]: unreadThread});
        await waitForBatchedUpdatesWithAct();

        // Then its parent is not fetched, because only a transaction thread is hidden in favor of its parent
        expect(openReport).not.toHaveBeenCalled();
    });

    it('does not fetch the parent of a read transaction thread', async () => {
        // Given a transaction thread with nothing unread, which cannot put its parent in the LHN in Focus mode
        const readThread: Report = {...unreadThread, lastVisibleActionCreated: '2025-01-20 11:30:00.000'};
        renderWithReports({[threadReportKey]: readThread});
        await waitForBatchedUpdatesWithAct();

        // Then no request is made
        expect(openReport).not.toHaveBeenCalled();
    });

    it('does nothing outside Focus mode', async () => {
        // Given the same cold-start state in Most recent mode, where OpenApp is not filtered and the parent is only missing in this test
        renderWithReports({[threadReportKey]: unreadThread}, CONST.PRIORITY_MODE.DEFAULT);
        await waitForBatchedUpdatesWithAct();

        // Then the hook stays out of the way
        expect(openReport).not.toHaveBeenCalled();
    });
});
