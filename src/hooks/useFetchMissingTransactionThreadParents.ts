/**
 * In Focus mode, OpenApp asks the server to return only the reports it considers unread or otherwise relevant. A comment
 * on a single-expense report lands on its transaction thread, so the thread comes back unread while its parent expense
 * report, read by its own timestamps, is left out. The LHN hides that thread in favor of the parent, so until the parent
 * is in Onyx the comment shows nowhere. This hook fetches such a missing parent once, without marking it read, after
 * which the existing LHN logic shows the expense report as unread.
 */
import {getReportAction, isTransactionThread} from '@libs/ReportActionsUtils';

import CONST from '@src/CONST';
import ONYXKEYS from '@src/ONYXKEYS';
import type {Report} from '@src/types/onyx';
import type PriorityMode from '@src/types/onyx/PriorityMode';

import type {OnyxCollection, OnyxEntry} from 'react-native-onyx';

import {useEffect, useRef} from 'react';

import useOpenReport from './useOpenReport';

function useFetchMissingTransactionThreadParents(reportUpdates: OnyxCollection<Report> | undefined, reports: OnyxCollection<Report>, priorityMode: OnyxEntry<PriorityMode>) {
    const openReport = useOpenReport();

    // Parents requested this session, so a thread that keeps changing (e.g. more comments) does not refetch its parent.
    const requestedParentReportIDs = useRef(new Set<string>());

    useEffect(() => {
        // Only Focus mode asks the server to filter the OpenApp reports, so only there can a thread arrive without its parent.
        if (priorityMode !== CONST.PRIORITY_MODE.GSD || !reportUpdates) {
            return;
        }

        for (const thread of Object.values(reportUpdates)) {
            const parentReportID = thread?.parentReportID;
            if (!thread || !parentReportID || reports?.[`${ONYXKEYS.COLLECTION.REPORT}${parentReportID}`] || requestedParentReportIDs.current.has(parentReportID)) {
                continue;
            }

            // The parent's IOU action tells a transaction thread apart from a comment thread, which the LHN can show on its own.
            // Only an unread thread can put its parent in the LHN, so a read one is not worth a request.
            const isUnreadTransactionThread =
                isTransactionThread(getReportAction(parentReportID, thread.parentReportActionID)) && (thread.lastVisibleActionCreated ?? '') > (thread.lastReadTime ?? '');
            if (!isUnreadTransactionThread) {
                continue;
            }

            requestedParentReportIDs.current.add(parentReportID);
            openReport({reportID: parentReportID, shouldMarkAsRead: false, hasReportActions: false});
        }
    }, [reportUpdates, reports, priorityMode, openReport]);
}

export default useFetchMissingTransactionThreadParents;
