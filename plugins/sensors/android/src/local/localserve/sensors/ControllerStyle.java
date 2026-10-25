package local.localserve.sensors;

import android.app.Activity;
import android.content.res.ColorStateList;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.view.View;
import android.view.ViewGroup;
import android.widget.*;

/** Shared native surfaces mirror Controller's rounded, quiet green palette.
 * Spacing uses density-independent units and source controls retain semantics. */
final class ControllerStyle {
    static android.app.AlertDialog.Builder dialog(Activity activity){boolean dark=activity.getSharedPreferences("sender",0).getBoolean("relayDark",true);return new android.app.AlertDialog.Builder(new android.view.ContextThemeWrapper(activity,dark?android.R.style.Theme_Material_Dialog_Alert:android.R.style.Theme_Material_Light_Dialog_Alert));}
    private final Activity activity;
    final int background,surface,ink,muted,accent;
    ControllerStyle(Activity activity){this.activity=activity;boolean dark=activity.getSharedPreferences("sender",0).getBoolean("relayDark",true);background=dark?0xff171c19:0xfff7f6f2;surface=dark?0xff242e27:0xffe8ede6;ink=dark?0xffe7ece7:0xff27342c;muted=dark?0xffadb9ae:0xff5d6f62;accent=dark?0xffa8e2c5:0xff345e45;}
    int dp(int value){return Math.round(value*activity.getResources().getDisplayMetrics().density);}
    GradientDrawable shape(int color,int radius){GradientDrawable result=new GradientDrawable();result.setColor(color);result.setCornerRadius(dp(radius));return result;}
    LinearLayout.LayoutParams slot(){LinearLayout.LayoutParams result=new LinearLayout.LayoutParams(-1,-2);result.setMargins(0,dp(6),0,dp(6));return result;}
    LinearLayout card(LinearLayout parent,String title){
        LinearLayout group=new LinearLayout(activity);group.setOrientation(LinearLayout.VERTICAL);
        group.setTag("controller-card");group.setPadding(dp(16),dp(16),dp(16),dp(16));group.setBackground(shape(surface,20));
        LinearLayout.LayoutParams params=slot();params.bottomMargin=dp(14);parent.addView(group,params);
        TextView heading=label(title,20);heading.setPadding(0,0,0,dp(8));group.addView(heading);return group;
    }
    private boolean insideCard(View view){
        android.view.ViewParent parent=view.getParent();
        while(parent instanceof View){if("controller-card".equals(((View)parent).getTag()))return true;parent=parent.getParent();}
        return false;
    }
    TextView label(String title,int size){TextView view=new TextView(activity);view.setText(title);view.setTextSize(size);view.setTextColor(size>=19?ink:muted);view.setPadding(0,dp(size>=19?18:8),0,dp(8));if(size>=19)view.setTypeface(null,Typeface.BOLD);return view;}
    Button button(String title,Runnable action){Button view=new Button(activity);view.setText(title);view.setAllCaps(false);view.setTextColor(ink);view.setTextSize(15);view.setMinHeight(dp(52));view.setPadding(dp(16),dp(10),dp(16),dp(10));view.setBackground(shape(surface,18));view.setLayoutParams(slot());view.setOnClickListener(ignored->action.run());return view;}
    void field(EditText view){view.setTextColor(ink);view.setHintTextColor(muted);view.setTextSize(16);view.setMinHeight(dp(52));view.setPadding(dp(16),dp(12),dp(16),dp(12));view.setBackground(shape(surface,16));view.setLayoutParams(slot());}
    void tree(View view){
        if("controller-card".equals(view.getTag()))view.setBackground(shape(surface,20));
        if(view instanceof EditText){field((EditText)view);}
        else if(view instanceof Button&&!(view instanceof CompoundButton)){Button button=(Button)view;button.setAllCaps(false);button.setTextColor(ink);button.setTextSize(15);button.setMinHeight(dp(50));button.setBackground(shape(insideCard(view)?background:surface,16));}
        else if(view instanceof CompoundButton){CompoundButton choice=(CompoundButton)view;choice.setTextColor(ink);choice.setTextSize(15);choice.setMinHeight(dp(52));choice.setPadding(dp(12),dp(10),dp(12),dp(10));choice.setButtonTintList(ColorStateList.valueOf(accent));choice.setBackground(shape(surface,16));if(choice instanceof Switch){((Switch)choice).setThumbTintList(ColorStateList.valueOf(accent));}}
        else if(view instanceof TextView){((TextView)view).setTextColor(ink);}
        if(view instanceof Spinner){Spinner select=(Spinner)view;select.setBackground(shape(surface,16));select.setPadding(dp(12),dp(8),dp(12),dp(8));select.setMinimumHeight(dp(52));}
        if(view instanceof ViewGroup){ViewGroup parent=(ViewGroup)view;for(int i=0;i<parent.getChildCount();i++)tree(parent.getChildAt(i));}
        if(view.getParent() instanceof LinearLayout&&!(view instanceof LinearLayout)&&!(view instanceof ScrollView)){
            LinearLayout parent=(LinearLayout)view.getParent();LinearLayout.LayoutParams params=(LinearLayout.LayoutParams)view.getLayoutParams();
            if(parent.getOrientation()==LinearLayout.HORIZONTAL){params.leftMargin=dp(4);params.rightMargin=dp(4);if(view instanceof Button){params.width=0;params.weight=1;((Button)view).setMinWidth(0);view.setMinimumWidth(0);}}else{params.topMargin=dp(5);params.bottomMargin=dp(5);}view.setLayoutParams(params);
        }
    }
}
