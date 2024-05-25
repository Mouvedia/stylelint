/** @typedef {import('stylelint').PostcssResult} PostcssResult */
/** @typedef {import('stylelint').DisabledRange} DisabledRange */
/** @typedef {[number, number?]} Tuple */

/**
 * @param {DisabledRange} object
 * @returns {Tuple}
 */
const cb = ({ start, end }) => [start, end];

/**
 * even though stylelint-disable comments cannot be inserted inside a declaration or a selector list,
 * new lines cannot be disregarded because FixerData['source'] will eventually be exposed
 * i.e. source must be accurate to be exploited
 * @see stylelint/stylelint#7192
 * @summary apply fixes while taking into account the disabled ranges
 * @param {PostcssResult} result
 */
export default function applyFixes(result) {
	const {
		disabledRanges,
		disabledRanges: { all = [] },
		fixersData,
		config,
	} = result.stylelint;
	const rules = Object.entries(fixersData);

	rules.forEach(([ruleName, array]) => {
		const ruleRanges = disabledRanges[ruleName]?.map(cb) || [];
		const ranges = all.map(cb).concat(ruleRanges);

		array.forEach(({ source, callback, args, unfixable }) => {
			const isInRange = (/** @type {Tuple} */ [start, end]) =>
				source.start.line >= start && (!end || source.start.line <= end);
			const mayFix =
				!unfixable && (config?.ignoreDisables || !ranges.length || !ranges.some(isInRange));

			if (mayFix) {
				const newSource = callback(args);
				const diff = newSource.end.line - source.end.line;

				if (!config?.ignoreDisables && diff)
					offsetDisabledRanges(disabledRanges, source.end.line, diff);
			}
		});
	});
}

/**
 * if a fix is attempted a stylelint-disable comment can either be before or after
 * i.e. stylelint-disable-line would have prevented the fix in the first place
 * @summary emend the start/end lines of the disabled ranges
 * @param {PostcssResult['stylelint']['disabledRanges']} disabledRanges
 * @param {number} endLine
 * @param {number} diff
 */
function offsetDisabledRanges(disabledRanges, endLine, diff) {
	const values = Object.values(disabledRanges);

	for (const element of values) {
		element.forEach((disabledRange) => {
			if (disabledRange.start > endLine) disabledRange.start += diff;

			if (disabledRange.end && disabledRange.end > endLine) disabledRange.end += diff;
		});
	}
}
