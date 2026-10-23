// Pine Script v6 built-in names used by the static analyzer.
// Namespaces listed in STRICT_MEMBERS are checked member-by-member; others are accepted leniently.

const w = (s: string) => s.trim().split(/\s+/);

export const KEYWORDS = new Set(
  w(`and or not if else for to by in while switch var varip import export method type enum true false na break continue
     series simple const int float bool string color line label box table array matrix map polyline linefill chart`),
);

export const BUILTIN_VARS = new Set(
  w(`open high low close volume hl2 hlc3 ohlc4 hlcc4 time time_close time_tradingday timenow bar_index last_bar_index
     last_bar_time year month weekofyear dayofmonth dayofweek hour minute second na ask bid`),
);

export const BUILTIN_FUNCS = new Set(
  w(`plot plotshape plotchar plotcandle plotbar plotarrow fill bgcolor barcolor hline indicator strategy library alert
     alertcondition nz na fixnan timestamp int float bool string max_bars_back input time time_close year month dayofmonth
     dayofweek hour minute second weekofyear`),
);

export const NAMESPACES = new Set(
  w(`ta math str request input strategy timeframe syminfo barstate color label line box table array matrix map chart session
     dividends earnings adjustment backadjustment settlement_as_close currency display extend font format hline location
     order plot position scale shape size text xloc yloc barmerge alert dayofweek runtime ticker polyline linefill log
     splits math text_format`),
);

export const STRICT_MEMBERS: Record<string, Set<string>> = {
  ta: new Set(
    w(`accdist alma atr barssince bb bbw cci change cmo cog correlation cross crossover crossunder cum dev dmi ema falling
       highest highestbars hma iii kc kcw linreg lowest lowestbars macd max median mfi min mode mom nvi obv
       percentile_linear_interpolation percentile_nearest_rank percentrank pivot_point_levels pivothigh pivotlow pvi pvt
       range rci rising rma roc rsi sar sma stdev stoch supertrend swma tr tsi valuewhen variance vwap vwma wad wma wpr wvad`),
  ),
  math: new Set(
    w(`abs acos asin atan avg ceil cos e exp floor log log10 max min phi pi pow random round round_to_mintick rphi sign
       sin sqrt sum tan todegrees toradians`),
  ),
  str: new Set(
    w(`contains endswith format format_time length lower match pos repeat replace replace_all split startswith substring
       tonumber tostring trim upper`),
  ),
  request: new Set(w('security security_lower_tf financial dividends earnings splits quandl economic seed currency_rate footprint')),
  input: new Set(w('bool color enum float int price session source string symbol text_area time timeframe')),
  barstate: new Set(w('isconfirmed isfirst ishistory islast islastconfirmedhistory isnew isrealtime')),
  timeframe: new Set(
    w('period multiplier isdaily isdwm isintraday isminutes ismonthly isseconds isticks isweekly main_period change from_seconds in_seconds'),
  ),
  strategy: new Set(
    w(`entry exit close close_all cancel cancel_all order position_size position_avg_price position_entry_name equity
       netprofit netprofit_percent grossprofit grossprofit_percent grossloss grossloss_percent initial_capital openprofit
       openprofit_percent closedtrades opentrades wintrades losstrades eventrades max_drawdown max_drawdown_percent max_runup
       max_runup_percent max_contracts_held_all max_contracts_held_long max_contracts_held_short account_currency long short
       fixed cash percent_of_equity convert_to_account convert_to_symbol default_entry_qty margin_liquidation_price
       avg_trade avg_trade_percent avg_winning_trade avg_winning_trade_percent avg_losing_trade avg_losing_trade_percent
       commission oca direction risk`),
  ),
  'strategy.closedtrades': new Set(
    w(`entry_bar_index entry_comment entry_id entry_price entry_time exit_bar_index exit_comment exit_id exit_price exit_time
       max_drawdown max_drawdown_percent max_runup max_runup_percent profit profit_percent size commission first_index`),
  ),
  'strategy.opentrades': new Set(
    w(`entry_bar_index entry_comment entry_id entry_price entry_time max_drawdown max_drawdown_percent max_runup
       max_runup_percent profit profit_percent size commission capital_held`),
  ),
  'strategy.commission': new Set(w('percent cash_per_contract cash_per_order')),
  'strategy.oca': new Set(w('none cancel reduce')),
  'strategy.direction': new Set(w('all long short')),
  'strategy.risk': new Set(w('allow_entry_in max_cons_loss_days max_drawdown max_intraday_filled_orders max_intraday_loss max_position_size')),
};

/** Named parameters accepted by frequently generated functions. */
export const NAMED_PARAMS: Record<string, Set<string>> = {
  strategy: new Set(
    w(`title shorttitle overlay format precision scale pyramiding calc_on_order_fills calc_on_every_tick max_bars_back
       backtest_fill_limits_assumption default_qty_type default_qty_value initial_capital currency slippage commission_type
       commission_value process_orders_on_close close_entries_rule margin_long margin_short explicit_plot_zorder
       max_lines_count max_labels_count max_boxes_count calc_bars_count risk_free_rate use_bar_magnifier
       fill_orders_on_standard_ohlc max_polylines_count dynamic_requests behind_chart`),
  ),
  indicator: new Set(
    w(`title shorttitle overlay format precision scale max_bars_back timeframe timeframe_gaps explicit_plot_zorder
       max_lines_count max_labels_count max_boxes_count calc_bars_count max_polylines_count dynamic_requests behind_chart`),
  ),
  'strategy.entry': new Set(w('id direction qty limit stop oca_name oca_type comment alert_message disable_alert')),
  'strategy.exit': new Set(
    w(`id from_entry qty qty_percent profit limit loss stop trail_price trail_points trail_offset oca_name comment
       comment_profit comment_loss comment_trailing alert_message alert_profit alert_loss alert_trailing disable_alert`),
  ),
  'strategy.close': new Set(w('id comment qty qty_percent alert_message immediately disable_alert')),
  'strategy.close_all': new Set(w('comment alert_message immediately disable_alert')),
  plot: new Set(w('series title color linewidth style trackprice histbase offset join editable show_last display format precision force_overlay linestyle')),
  plotshape: new Set(w('series title style location color offset text textcolor editable size show_last display format precision force_overlay')),
  plotchar: new Set(w('series title char location color offset text textcolor editable size show_last display format precision force_overlay')),
  bgcolor: new Set(w('color offset editable show_last title display force_overlay')),
  fill: new Set(w('plot1 plot2 hline1 hline2 color title editable show_last fillgaps display top_value bottom_value top_color bottom_color')),
  'label.new': new Set(w('x y text xloc yloc color style textcolor size textalign tooltip text_font_family force_overlay text_formatting point')),
  'line.new': new Set(w('x1 y1 x2 y2 xloc extend color style width force_overlay first_point second_point')),
  'box.new': new Set(
    w(`left top right bottom border_color border_width border_style extend xloc bgcolor text text_size text_color text_halign
       text_valign text_wrap text_font_family force_overlay text_formatting top_left bottom_right`),
  ),
  'table.new': new Set(w('position columns rows bgcolor frame_color frame_width border_color border_width force_overlay')),
  'table.cell': new Set(w('table_id column row text width height text_color text_halign text_valign text_size bgcolor tooltip text_font_family text_formatting')),
  'input.int': new Set(w('defval title minval maxval step tooltip inline group confirm display active options')),
  'input.float': new Set(w('defval title minval maxval step tooltip inline group confirm display active options')),
  'input.bool': new Set(w('defval title tooltip inline group confirm display active')),
  'input.string': new Set(w('defval title options tooltip inline group confirm display active')),
  'input.source': new Set(w('defval title tooltip inline group display active')),
  'input.timeframe': new Set(w('defval title options tooltip inline group confirm display active')),
  'input.session': new Set(w('defval title options tooltip inline group confirm display active')),
  'input.time': new Set(w('defval title tooltip inline group confirm display active')),
  'input.color': new Set(w('defval title tooltip inline group confirm display active')),
  'request.security': new Set(w('symbol timeframe expression gaps lookahead ignore_invalid_symbol currency calc_bars_count')),
  alert: new Set(w('message freq')),
  alertcondition: new Set(w('condition title message')),
};

/** Functions that must be called from the global scope. */
export const GLOBAL_ONLY = new Set(w('plot plotshape plotchar plotcandle plotbar plotarrow fill bgcolor barcolor hline alertcondition indicator strategy library'));

/** v4/v5 global function names that require a namespace in v5+/v6. */
export const LEGACY_GLOBALS = new Set(
  w(`sma ema wma rma rsi atr crossover crossunder cross highest lowest stdev change security study iff tostring valuewhen
     barssince pivothigh pivotlow macd stoch vwap tr sar cci mfi obv cum abs max min round sqrt log pow avg`),
);
